//! Zero-dependency SVG sanitizer and light optimizer.
//!
//! Pipeline: strict XML tokenizer (`parse_events`) → allow-list sanitizer → serializer.
//! The output is re-parsed by the same tokenizer before it is returned, so callers only
//! ever receive well-formed SVG with a single `<svg>` root in the SVG namespace.
//!
//! Security policy (see `docs/03-system-design.md` §2 SVG):
//! - Elements outside the SVG allow-list are dropped together with their subtree
//!   (`script`, `foreignObject`, `iframe`, editor namespaces, unknown elements …).
//! - Event handler attributes (`on*`), `javascript:` values and animations that target
//!   `href` / `on*` / `style` are removed.
//! - References may only point inside the document (`#id`, `url(#id)`); `<image>` /
//!   `<feImage>` may additionally embed `data:image/{png,jpeg,gif,webp,avif}`.
//! - DOCTYPE, processing instructions, comments and non-predefined entities are removed,
//!   so entity expansion and external stylesheets never reach the output.

pub const MAX_SVG_BYTES: usize = 20 * 1024 * 1024;
const MAX_DEPTH: usize = 256;
pub const SVG_NS: &str = "http://www.w3.org/2000/svg";
pub const XLINK_NS: &str = "http://www.w3.org/1999/xlink";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SvgError {
    TooLarge,
    NotUtf8,
    Malformed,
    NotSvgRoot,
    TooDeep,
}

impl SvgError {
    /// Stable numeric code shared with the WASM / JS layer.
    pub fn code(self) -> u32 {
        match self {
            SvgError::TooLarge => 1,
            SvgError::NotUtf8 => 2,
            SvgError::Malformed => 3,
            SvgError::NotSvgRoot => 4,
            SvgError::TooDeep => 5,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SvgCleanOptions {
    /// Drop whitespace-only text between elements (kept inside text content and `xml:space="preserve"`).
    pub collapse_whitespace: bool,
}

impl Default for SvgCleanOptions {
    fn default() -> Self {
        SvgCleanOptions { collapse_whitespace: true }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SvgCleanReport {
    pub input_bytes: usize,
    pub output_bytes: usize,
    /// Scripts, foreign content, event handlers, `javascript:` values, unsafe CSS or animations.
    pub removed_active: u32,
    /// References to resources outside the document (http, file, relative paths, `@import` …).
    pub removed_external: u32,
    /// Comments, DOCTYPE, processing instructions, `<metadata>`, editor namespaces, unknown entities/elements.
    pub removed_metadata: u32,
    pub has_view_box: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SvgCleanOutput {
    pub svg: String,
    pub report: SvgCleanReport,
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum Event<'a> {
    Start { name: &'a str, attrs: Vec<(&'a str, String)>, self_closing: bool },
    End,
    Text(String),
    Comment,
    Instruction,
    Doctype,
    UnknownEntities(u32),
}

struct Parsed<'a> {
    events: Vec<Event<'a>>,
}

fn is_name_start(c: char) -> bool {
    c.is_ascii_alphabetic() || c == '_' || c == ':' || !c.is_ascii()
}

fn is_name_char(c: char) -> bool {
    is_name_start(c) || c.is_ascii_digit() || c == '-' || c == '.'
}

fn is_xml_ws(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r')
}

struct Cursor<'a> {
    src: &'a str,
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn rest(&self) -> &'a str {
        &self.src[self.pos..]
    }

    fn skip_ws(&mut self) {
        let trimmed = self.rest().trim_start_matches(is_xml_ws);
        self.pos = self.src.len() - trimmed.len();
    }

    fn name(&mut self) -> Result<&'a str, SvgError> {
        let rest = self.rest();
        let mut chars = rest.char_indices();
        match chars.next() {
            Some((_, c)) if is_name_start(c) => {}
            _ => return Err(SvgError::Malformed),
        }
        let end = chars.find(|&(_, c)| !is_name_char(c)).map_or(rest.len(), |(i, _)| i);
        self.pos += end;
        Ok(&rest[..end])
    }

    fn expect(&mut self, token: &str) -> Result<(), SvgError> {
        if self.rest().starts_with(token) {
            self.pos += token.len();
            Ok(())
        } else {
            Err(SvgError::Malformed)
        }
    }

    /// Advances past `terminator`, returning the text before it.
    fn until(&mut self, terminator: &str) -> Result<&'a str, SvgError> {
        let rest = self.rest();
        let idx = rest.find(terminator).ok_or(SvgError::Malformed)?;
        self.pos += idx + terminator.len();
        Ok(&rest[..idx])
    }
}

/// Decodes predefined and numeric character references. Unknown named entities are dropped
/// (counted) because the DOCTYPE that could define them is never kept.
fn decode_entities(raw: &str, unknown: &mut u32) -> Result<String, SvgError> {
    if !raw.contains('&') {
        return Ok(raw.to_string());
    }
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(idx) = rest.find('&') {
        out.push_str(&rest[..idx]);
        rest = &rest[idx..];
        let Some(semi) = rest[..rest.len().min(40)].find(';') else {
            // Bare ampersand: keep it literally, the serializer re-escapes it.
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let body = &rest[1..semi];
        let decoded = match body {
            "lt" => Some('<'),
            "gt" => Some('>'),
            "amp" => Some('&'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if body.starts_with("#x") || body.starts_with("#X") => {
                let code = u32::from_str_radix(&body[2..], 16).map_err(|_| SvgError::Malformed)?;
                Some(valid_xml_char(code)?)
            }
            _ if body.starts_with('#') => {
                let code = body[1..].parse::<u32>().map_err(|_| SvgError::Malformed)?;
                Some(valid_xml_char(code)?)
            }
            _ if !body.is_empty() && body.chars().all(is_name_char) => {
                *unknown += 1;
                None
            }
            _ => {
                out.push('&');
                rest = &rest[1..];
                continue;
            }
        };
        if let Some(c) = decoded {
            out.push(c);
        }
        rest = &rest[semi + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

fn valid_xml_char(code: u32) -> Result<char, SvgError> {
    let c = char::from_u32(code).ok_or(SvgError::Malformed)?;
    let ok = matches!(c, '\t' | '\n' | '\r') || (c >= ' ' && c != '\u{FFFE}' && c != '\u{FFFF}');
    if ok { Ok(c) } else { Err(SvgError::Malformed) }
}

fn skip_doctype(cur: &mut Cursor<'_>) -> Result<(), SvgError> {
    // `<!DOCTYPE` already consumed. Skip quoted strings and the internal subset `[...]`.
    let mut in_subset = false;
    let mut quote: Option<char> = None;
    for (i, c) in cur.rest().char_indices() {
        match (quote, c) {
            (Some(q), _) if c == q => quote = None,
            (Some(_), _) => {}
            (None, '"' | '\'') => quote = Some(c),
            (None, '[') => in_subset = true,
            (None, ']') => in_subset = false,
            (None, '>') if !in_subset => {
                cur.pos += i + 1;
                return Ok(());
            }
            _ => {}
        }
    }
    Err(SvgError::Malformed)
}

/// Strict, non-recursive XML tokenizer that also validates nesting and the single `<svg>` root.
fn parse_events(src: &str) -> Result<Parsed<'_>, SvgError> {
    let mut cur = Cursor { src, pos: 0 };
    let mut events = Vec::new();
    let mut stack: Vec<&str> = Vec::new();
    let mut root_seen = false;
    let mut root_closed = false;

    while cur.pos < src.len() {
        let rest = cur.rest();
        if !rest.starts_with('<') {
            let end = rest.find('<').unwrap_or(rest.len());
            let raw = &rest[..end];
            cur.pos += end;
            if stack.is_empty() {
                if !raw.chars().all(is_xml_ws) {
                    return Err(SvgError::Malformed);
                }
                continue;
            }
            let mut unknown = 0;
            let text = decode_entities(raw, &mut unknown)?;
            if unknown > 0 {
                events.push(Event::UnknownEntities(unknown));
            }
            events.push(Event::Text(text));
            continue;
        }

        if rest.starts_with("<!--") {
            cur.pos += 4;
            let body = cur.until("-->")?;
            if body.contains("--") {
                return Err(SvgError::Malformed);
            }
            events.push(Event::Comment);
        } else if rest.starts_with("<![CDATA[") {
            if stack.is_empty() {
                return Err(SvgError::Malformed);
            }
            cur.pos += 9;
            let body = cur.until("]]>")?;
            events.push(Event::Text(body.to_string()));
        } else if rest.len() >= 9 && rest[..9].eq_ignore_ascii_case("<!DOCTYPE") {
            if root_seen {
                return Err(SvgError::Malformed);
            }
            cur.pos += 9;
            skip_doctype(&mut cur)?;
            events.push(Event::Doctype);
        } else if rest.starts_with("<?") {
            cur.pos += 2;
            cur.until("?>")?;
            events.push(Event::Instruction);
        } else if rest.starts_with("</") {
            cur.pos += 2;
            let name = cur.name()?;
            cur.skip_ws();
            cur.expect(">")?;
            if stack.pop() != Some(name) {
                return Err(SvgError::Malformed);
            }
            if stack.is_empty() {
                root_closed = true;
            }
            events.push(Event::End);
        } else {
            cur.pos += 1;
            let name = cur.name()?;
            if stack.is_empty() {
                if root_seen || name != "svg" {
                    return Err(if root_closed { SvgError::Malformed } else { SvgError::NotSvgRoot });
                }
                root_seen = true;
            }
            let mut attrs: Vec<(&str, String)> = Vec::new();
            let self_closing;
            loop {
                let had_ws = cur.rest().starts_with(is_xml_ws);
                cur.skip_ws();
                if cur.rest().starts_with("/>") {
                    cur.pos += 2;
                    self_closing = true;
                    break;
                }
                if cur.rest().starts_with('>') {
                    cur.pos += 1;
                    self_closing = false;
                    break;
                }
                if !had_ws {
                    return Err(SvgError::Malformed);
                }
                let attr_name = cur.name()?;
                cur.skip_ws();
                cur.expect("=")?;
                cur.skip_ws();
                let quote = match cur.rest().chars().next() {
                    Some(q @ ('"' | '\'')) => q,
                    _ => return Err(SvgError::Malformed),
                };
                cur.pos += 1;
                let raw = cur.until(if quote == '"' { "\"" } else { "'" })?;
                if raw.contains('<') || attrs.iter().any(|(n, _)| *n == attr_name) {
                    return Err(SvgError::Malformed);
                }
                let mut unknown = 0;
                let value = decode_entities(raw, &mut unknown)?;
                if unknown > 0 {
                    events.push(Event::UnknownEntities(unknown));
                }
                attrs.push((attr_name, value));
            }
            if !self_closing {
                stack.push(name);
                if stack.len() > MAX_DEPTH {
                    return Err(SvgError::TooDeep);
                }
            } else if stack.is_empty() {
                root_closed = true;
            }
            events.push(Event::Start { name, attrs, self_closing });
        }
    }

    if !root_seen {
        return Err(SvgError::NotSvgRoot);
    }
    if !stack.is_empty() {
        return Err(SvgError::Malformed);
    }
    Ok(Parsed { events })
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

const ALLOWED_ELEMENTS: &[&str] = &[
    "svg", "g", "defs", "symbol", "use", "switch", "view", "a", "title", "desc", "style",
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "image",
    "text", "tspan", "textPath",
    "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "marker",
    "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix",
    "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood",
    "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feImage", "feMerge",
    "feMergeNode", "feMorphology", "feOffset", "fePointLight", "feSpecularLighting",
    "feSpotLight", "feTile", "feTurbulence",
    "animate", "animateMotion", "animateTransform", "mpath", "set",
];

/// Elements that are removed because they can run code or embed non-SVG documents.
const ACTIVE_ELEMENTS: &[&str] = &["script", "foreignObject", "iframe", "embed", "object", "handler", "listener"];

const ANIMATION_ELEMENTS: &[&str] = &["animate", "animateMotion", "animateTransform", "set"];

const TEXT_CONTENT_ELEMENTS: &[&str] = &["text", "tspan", "textPath", "title", "desc", "style"];

const EMBEDDABLE_DATA_PREFIXES: &[&str] = &[
    "data:image/png;base64,",
    "data:image/jpeg;base64,",
    "data:image/jpg;base64,",
    "data:image/gif;base64,",
    "data:image/webp;base64,",
    "data:image/avif;base64,",
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Removal {
    Active,
    External,
    Metadata,
}

/// Lower-cased value with ASCII whitespace and control characters removed, mirroring how
/// URL parsers ignore tabs/newlines (so `java\tscript:` is still detected).
fn normalized(value: &str) -> String {
    value.chars().filter(|c| *c > ' ').flat_map(char::to_lowercase).collect()
}

fn is_local_fragment(value: &str) -> bool {
    value.trim().starts_with('#')
}

fn is_embeddable_data(value: &str, element: &str) -> bool {
    if element != "image" && element != "feImage" {
        return false;
    }
    let n = normalized(value);
    EMBEDDABLE_DATA_PREFIXES.iter().any(|p| n.starts_with(p))
        && n.bytes().skip_while(|b| *b != b',').skip(1).all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
}

/// Every `url(...)` in the value must point at a local `#id`.
fn urls_are_local(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(idx) = rest.find("url(") {
        rest = &rest[idx + 4..];
        let target = rest.trim_start_matches(|c: char| c.is_ascii_whitespace() || c == '"' || c == '\'');
        if !target.starts_with('#') {
            return false;
        }
    }
    true
}

fn css_removal(css: &str) -> Option<Removal> {
    let n = normalized(css);
    if n.contains('\\') || n.contains("expression(") || n.contains("javascript:") || n.contains("-moz-binding") || n.contains("behavior:") {
        return Some(Removal::Active);
    }
    if n.contains("@import") || !urls_are_local(&n) {
        return Some(Removal::External);
    }
    None
}

fn strip_css_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        match rest[start + 2..].find("*/") {
            Some(end) => rest = &rest[start + 2 + end + 2..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out
}

fn attribute_removal(element: &str, name: &str, value: &str, is_root: bool) -> Option<Removal> {
    let lower = name.to_ascii_lowercase();
    if lower.starts_with("on") {
        return Some(Removal::Active);
    }
    if name == "xmlns" {
        // Root keeps (or receives) the SVG namespace; elsewhere it is redundant.
        return if is_root { None } else { Some(Removal::Metadata) };
    }
    if name == "xmlns:xlink" {
        return if is_root && value == XLINK_NS { None } else { Some(Removal::Metadata) };
    }
    if name.contains(':') && !matches!(name, "xlink:href" | "xml:space" | "xml:lang") {
        return Some(if name == "xml:base" { Removal::External } else { Removal::Metadata });
    }
    let n = normalized(value);
    if n.contains("javascript:") || n.contains("vbscript:") {
        return Some(Removal::Active);
    }
    if name == "href" || name == "xlink:href" {
        if is_local_fragment(value) || is_embeddable_data(value, element) {
            return None;
        }
        return Some(if n.starts_with("data:") { Removal::Active } else { Removal::External });
    }
    if lower == "style" {
        return css_removal(value);
    }
    if !urls_are_local(value) {
        return Some(Removal::External);
    }
    None
}

fn animation_is_dangerous(attrs: &[(&str, String)]) -> bool {
    attrs.iter().any(|(name, value)| {
        *name == "attributeName" && {
            let target = normalized(value);
            target == "href" || target == "xlink:href" || target.starts_with("on") || target == "style"
        }
    })
}

// ---------------------------------------------------------------------------
// Sanitizer + serializer
// ---------------------------------------------------------------------------

fn push_escaped_attr(out: &mut String, value: &str) {
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '"' => out.push_str("&quot;"),
            '\n' => out.push_str("&#10;"),
            '\r' => out.push_str("&#13;"),
            '\t' => out.push_str("&#9;"),
            _ => out.push(c),
        }
    }
}

fn push_escaped_text(out: &mut String, value: &str) {
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(c),
        }
    }
}

struct Frame {
    name: String,
    preserve_space: bool,
}

struct StyleBuffer {
    tag: String,
    css: String,
    poisoned: bool,
}

struct Writer {
    out: String,
    /// The last start tag is still open (`<name attrs`), so an immediately following end tag can become `/>`.
    open_tag: bool,
}

impl Writer {
    fn close_open_tag(&mut self) {
        if self.open_tag {
            self.out.push('>');
            self.open_tag = false;
        }
    }
}

fn count(report: &mut SvgCleanReport, removal: Removal) {
    match removal {
        Removal::Active => report.removed_active += 1,
        Removal::External => report.removed_external += 1,
        Removal::Metadata => report.removed_metadata += 1,
    }
}

fn element_removal(name: &str, attrs: &[(&str, String)]) -> Option<Removal> {
    if ACTIVE_ELEMENTS.contains(&name) {
        return Some(Removal::Active);
    }
    if !ALLOWED_ELEMENTS.contains(&name) {
        return Some(Removal::Metadata);
    }
    if attrs.iter().any(|(n, v)| *n == "xmlns" && v != SVG_NS) {
        return Some(Removal::Metadata);
    }
    if ANIMATION_ELEMENTS.contains(&name) && animation_is_dangerous(attrs) {
        return Some(Removal::Active);
    }
    None
}

pub fn clean_svg(input: &[u8], options: SvgCleanOptions) -> Result<SvgCleanOutput, SvgError> {
    if input.len() > MAX_SVG_BYTES {
        return Err(SvgError::TooLarge);
    }
    let text = core::str::from_utf8(input).map_err(|_| SvgError::NotUtf8)?;
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let parsed = parse_events(text)?;

    let mut report = SvgCleanReport { input_bytes: input.len(), ..SvgCleanReport::default() };
    let mut w = Writer { out: String::with_capacity(text.len()), open_tag: false };
    let mut frames: Vec<Frame> = Vec::new();
    let mut skip_depth = 0usize;
    let mut style: Option<StyleBuffer> = None;
    let mut root_attr_insert_at: Option<usize> = None;
    let mut root_has_xlink = false;
    let mut uses_xlink = false;

    for event in parsed.events {
        match event {
            Event::Comment | Event::Instruction | Event::Doctype => {
                if skip_depth == 0 {
                    report.removed_metadata += 1;
                }
            }
            Event::UnknownEntities(n) => report.removed_metadata += n,
            Event::Start { name, attrs, self_closing } => {
                if skip_depth > 0 {
                    if !self_closing {
                        skip_depth += 1;
                    }
                    continue;
                }
                if let Some(buf) = style.as_mut() {
                    // Elements are not allowed inside <style>; drop the whole stylesheet.
                    buf.poisoned = true;
                    if !self_closing {
                        skip_depth = 1;
                    }
                    continue;
                }
                let is_root = frames.is_empty() && root_attr_insert_at.is_none();
                if !is_root {
                    if let Some(removal) = element_removal(name, &attrs) {
                        count(&mut report, removal);
                        if !self_closing {
                            skip_depth = 1;
                        }
                        continue;
                    }
                } else if attrs.iter().any(|(n, v)| *n == "xmlns" && v != SVG_NS) {
                    return Err(SvgError::NotSvgRoot);
                }

                let parent_preserve = frames.last().is_some_and(|f| f.preserve_space);
                let mut preserve_space = parent_preserve;
                let mut tag = String::new();
                tag.push('<');
                tag.push_str(name);
                if is_root {
                    tag.push_str(" xmlns=\"");
                    tag.push_str(SVG_NS);
                    tag.push('"');
                }
                for (attr_name, value) in &attrs {
                    if let Some(removal) = attribute_removal(name, attr_name, value, is_root) {
                        count(&mut report, removal);
                        continue;
                    }
                    if *attr_name == "xmlns" {
                        continue; // already emitted with the canonical value
                    }
                    if *attr_name == "xml:space" {
                        preserve_space = value == "preserve";
                    }
                    if *attr_name == "xmlns:xlink" {
                        root_has_xlink = true;
                    }
                    if *attr_name == "xlink:href" {
                        uses_xlink = true;
                    }
                    if is_root && *attr_name == "viewBox" {
                        report.has_view_box = true;
                    }
                    let cleaned_value;
                    let value = if attr_name.eq_ignore_ascii_case("style") {
                        cleaned_value = strip_css_comments(value).trim().to_string();
                        if cleaned_value.is_empty() {
                            continue;
                        }
                        &cleaned_value
                    } else {
                        value
                    };
                    tag.push(' ');
                    tag.push_str(attr_name);
                    tag.push_str("=\"");
                    push_escaped_attr(&mut tag, value);
                    tag.push('"');
                }

                // A reference element whose only (external) href was removed renders nothing; drop it.
                if matches!(name, "use" | "image" | "feImage") && !tag.contains(" href=\"") && !tag.contains(" xlink:href=\"") {
                    if !self_closing {
                        skip_depth = 1;
                    }
                    continue;
                }

                if name == "style" && !self_closing {
                    style = Some(StyleBuffer { tag, css: String::new(), poisoned: false });
                    frames.push(Frame { name: name.to_string(), preserve_space });
                    continue;
                }

                w.close_open_tag();
                if is_root {
                    root_attr_insert_at = Some(w.out.len() + tag.len());
                }
                w.out.push_str(&tag);
                if self_closing {
                    w.out.push_str("/>");
                } else {
                    w.open_tag = true;
                    frames.push(Frame { name: name.to_string(), preserve_space });
                }
            }
            Event::End => {
                if skip_depth > 0 {
                    skip_depth -= 1;
                    continue;
                }
                let frame = frames.pop().ok_or(SvgError::Malformed)?;
                if frame.name == "style" {
                    if let Some(buf) = style.take() {
                        let css = strip_css_comments(&buf.css);
                        let removal = if buf.poisoned { Some(Removal::Active) } else { css_removal(&css) };
                        if let Some(removal) = removal {
                            count(&mut report, removal);
                            continue;
                        }
                        w.close_open_tag();
                        w.out.push_str(&buf.tag);
                        let css = css.trim();
                        if css.is_empty() {
                            w.out.push_str("/>");
                        } else {
                            w.out.push('>');
                            push_escaped_text(&mut w.out, css);
                            w.out.push_str("</style>");
                        }
                    }
                    continue;
                }
                if w.open_tag {
                    w.out.push_str("/>");
                    w.open_tag = false;
                } else {
                    w.out.push_str("</");
                    w.out.push_str(&frame.name);
                    w.out.push('>');
                }
            }
            Event::Text(value) => {
                if skip_depth > 0 || value.is_empty() {
                    continue;
                }
                if let Some(buf) = style.as_mut() {
                    buf.css.push_str(&value);
                    continue;
                }
                let Some(frame) = frames.last() else { continue };
                let in_text_content = TEXT_CONTENT_ELEMENTS.contains(&frame.name.as_str());
                if options.collapse_whitespace
                    && !in_text_content
                    && !frame.preserve_space
                    && value.chars().all(is_xml_ws)
                {
                    continue;
                }
                w.close_open_tag();
                push_escaped_text(&mut w.out, &value);
            }
        }
    }

    if uses_xlink
        && !root_has_xlink
        && let Some(at) = root_attr_insert_at
    {
        w.out.insert_str(at, &format!(" xmlns:xlink=\"{XLINK_NS}\""));
    }
    w.out.push('\n');

    // Defense in depth: the output must itself be a well-formed single-root SVG.
    parse_events(&w.out)?;
    report.output_bytes = w.out.len();
    Ok(SvgCleanOutput { svg: w.out, report })
}

pub fn serialize_report_json(report: &SvgCleanReport) -> String {
    format!(
        "{{\"inputBytes\":{},\"outputBytes\":{},\"removedActive\":{},\"removedExternal\":{},\"removedMetadata\":{},\"hasViewBox\":{}}}",
        report.input_bytes,
        report.output_bytes,
        report.removed_active,
        report.removed_external,
        report.removed_metadata,
        report.has_view_box
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean(src: &str) -> SvgCleanOutput {
        clean_svg(src.as_bytes(), SvgCleanOptions::default()).expect("clean")
    }

    const SAFE: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 120 60" width="120" height="60">
  <defs>
    <linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient>
    <symbol id="dot"><circle cx="5" cy="5" r="5"/></symbol>
  </defs>
  <rect x="0" y="0" width="120" height="60" fill="url(#g)" style="stroke: url('#g'); stroke-width: 2"/>
  <use href="#dot" x="10" y="10"/>
  <use xlink:href="#dot" x="30" y="10"/>
  <text x="10" y="50" xml:space="preserve">Hello  &amp; &lt;world&gt;</text>
</svg>"##;

    #[test]
    fn keeps_view_box_shapes_and_local_references() {
        let out = clean(SAFE);
        assert!(out.svg.starts_with(r#"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 120 60""#));
        for needle in [
            r#"<linearGradient id="g">"#,
            r##"fill="url(#g)""##,
            r##"<use href="#dot" x="10" y="10"/>"##,
            r##"<use xlink:href="#dot" x="30" y="10"/>"##,
            "<circle cx=\"5\" cy=\"5\" r=\"5\"/>",
            "Hello  &amp; &lt;world&gt;",
        ] {
            assert!(out.svg.contains(needle), "missing {needle} in {}", out.svg);
        }
        assert!(out.report.has_view_box);
        assert_eq!(out.report.removed_active, 0);
        assert_eq!(out.report.removed_external, 0);
        assert_eq!(out.report.removed_metadata, 0);
        assert!(!out.svg.contains("\n  <"), "whitespace between elements collapsed");
    }

    const HOSTILE: &str = r##"<?xml version="1.0"?>
<?xml-stylesheet href="https://evil.example.com/x.css"?>
<!DOCTYPE svg [ <!ENTITY a "aaaaaaaaaa"> <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;"> ]>
<!-- tracker comment -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 10 10" onload="alert(1)" inkscape:version="1.0">
  <metadata><rdf:RDF/></metadata>
  <script>alert(1)</script>
  <script xlink:href="https://evil.example.com/a.js"/>
  <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject>
  <inkscape:grid/>
  <style>@import url(https://evil.example.com/a.css); rect { fill: red }</style>
  <style>rect { background: url("https://evil.example.com/t.png") }</style>
  <style>/* ok */ circle { fill: blue }</style>
  <a href="javascript:alert(1)"><rect width="1" height="1"/></a>
  <a xlink:href="&#106;ava&#x09;script:alert(1)"><rect width="2" height="2"/></a>
  <a href="https://example.com/"><rect width="3" height="3"/></a>
  <image href="https://evil.example.com/pixel.png" width="1" height="1"/>
  <image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>
  <image href="data:text/html;base64,PHNjcmlwdD4=" width="1" height="1"/>
  <use href="https://evil.example.com/sprite.svg#icon"/>
  <use href="other.svg#icon"/>
  <rect width="1" height="1" fill="url(https://evil.example.com/p.svg#g)" style="fill: url(http://evil.example.com/a)"/>
  <rect width="1" height="1" onclick="alert(1)" ONMOUSEOVER="alert(2)" xml:base="https://evil.example.com/"/>
  <set attributeName="href" to="javascript:alert(1)"/>
  <animate attributeName="xlink:href" values="javascript:alert(1)"/>
  <animate attributeName="opacity" from="0" to="1" dur="1s"/>
  <text>&b;</text>
  <iframe src="https://evil.example.com/"/>
</svg>"##;

    #[test]
    fn removes_active_content_and_external_references() {
        let out = clean(HOSTILE);
        let svg = out.svg.to_ascii_lowercase();
        for banned in [
            "<script", "onload", "onclick", "onmouseover", "onerror", "foreignobject", "javascript", "evil.example.com",
            "example.com", "other.svg", "@import", "xml-stylesheet", "doctype", "entity", "inkscape", "metadata",
            "<!--", "iframe", "<set", "xml:base", "data:text",
        ] {
            assert!(!svg.contains(banned), "found {banned} in {}", out.svg);
        }
        assert!(!svg.contains("<use"), "use without a local href is dropped: {}", out.svg);
        assert_eq!(svg.matches("<image").count(), 1, "only the embedded PNG remains: {}", out.svg);
        for kept in [
            "viewbox=\"0 0 10 10\"",
            "<style>circle { fill: blue }</style>",
            "<image href=\"data:image/png;base64,ivborw0kggo=\" width=\"1\" height=\"1\"/>",
            "<animate attributename=\"opacity\" from=\"0\" to=\"1\" dur=\"1s\"/>",
            "<a><rect width=\"3\" height=\"3\"/></a>",
        ] {
            assert!(svg.contains(kept), "missing {kept} in {}", out.svg);
        }
        assert!(out.report.removed_active >= 12, "{:?}", out.report);
        assert!(out.report.removed_external >= 7, "{:?}", out.report);
        assert!(out.report.removed_metadata >= 6, "{:?}", out.report);
        // Entity references from the dropped DOCTYPE are removed, never expanded.
        assert!(svg.contains("<text/>"), "{}", out.svg);
        parse_events(&out.svg).expect("output re-parses");
    }

    #[test]
    fn output_is_idempotent_and_smaller_for_bloated_input() {
        let first = clean(HOSTILE);
        let second = clean(&first.svg);
        assert_eq!(first.svg, second.svg);
        assert_eq!(second.report.removed_active + second.report.removed_external + second.report.removed_metadata, 0);
        assert!(first.report.output_bytes < first.report.input_bytes);
    }

    #[test]
    fn adds_missing_namespaces_for_standalone_rendering() {
        let out = clean(r##"<svg viewBox="0 0 1 1"><use xlink:href="#a"/><g id="a"/></svg>"##);
        assert_eq!(
            out.svg,
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\" xmlns:xlink=\"http://www.w3.org/1999/xlink\"><use xlink:href=\"#a\"/><g id=\"a\"/></svg>\n"
        );
    }

    #[test]
    fn keeps_whitespace_when_collapse_is_disabled() {
        let src = "<svg viewBox=\"0 0 1 1\">\n  <g/>\n</svg>";
        let out = clean_svg(src.as_bytes(), SvgCleanOptions { collapse_whitespace: false }).unwrap();
        assert!(out.svg.contains("\n  <g/>\n"));
    }

    #[test]
    fn rejects_malformed_or_non_svg_input() {
        let cases: &[(&[u8], SvgError)] = &[
            (b"<svg><g></svg>", SvgError::Malformed),
            (b"<svg><g></g>", SvgError::Malformed),
            (b"<svg a=\"1\" a=\"2\"/>", SvgError::Malformed),
            (b"<svg a=1/>", SvgError::Malformed),
            (b"<svg/><svg/>", SvgError::Malformed),
            (b"text<svg/>", SvgError::Malformed),
            (b"<html><svg/></html>", SvgError::NotSvgRoot),
            (b"<?xml version=\"1.0\"?>", SvgError::NotSvgRoot),
            (b"<svg xmlns=\"http://www.w3.org/1999/xhtml\"/>", SvgError::NotSvgRoot),
            (b"<svg>&#0;</svg>", SvgError::Malformed),
            (b"<svg>\xff</svg>", SvgError::NotUtf8),
        ];
        for (input, expected) in cases {
            assert_eq!(clean_svg(input, SvgCleanOptions::default()).unwrap_err(), *expected, "{}", String::from_utf8_lossy(input));
        }
        let deep = format!("<svg>{}{}</svg>", "<g>".repeat(MAX_DEPTH + 1), "</g>".repeat(MAX_DEPTH + 1));
        assert_eq!(clean_svg(deep.as_bytes(), SvgCleanOptions::default()).unwrap_err(), SvgError::TooDeep);
        assert_eq!(clean_svg(&vec![b' '; MAX_SVG_BYTES + 1], SvgCleanOptions::default()).unwrap_err(), SvgError::TooLarge);
    }

    #[test]
    fn serializes_report_json() {
        let out = clean(SAFE);
        let json = serialize_report_json(&out.report);
        assert!(json.starts_with(&format!("{{\"inputBytes\":{},", SAFE.len())));
        assert!(json.ends_with(",\"removedActive\":0,\"removedExternal\":0,\"removedMetadata\":0,\"hasViewBox\":true}"));
    }
}
