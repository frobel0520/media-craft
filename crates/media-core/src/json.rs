//! Zero-dependency JSON serializer for InspectReport.

use crate::InspectReport;

pub fn serialize_inspect_report(report: &InspectReport) -> String {
    let mut out = String::with_capacity(256);
    out.push('{');

    push_kv_str(&mut out, "format", report.format.as_str(), false);
    push_kv_str(&mut out, "mimeType", report.format.mime_type(), true);
    push_kv_usize(&mut out, "byteLength", report.byte_length, true);
    push_kv_opt_u32(&mut out, "width", report.width, true);
    push_kv_opt_u32(&mut out, "height", report.height, true);
    push_kv_bool(&mut out, "hasExif", report.metadata.has_exif, true);
    push_kv_bool(&mut out, "hasGps", report.metadata.has_gps, true);
    push_kv_bool(&mut out, "hasXmp", report.metadata.has_xmp, true);
    push_kv_bool(&mut out, "hasIcc", report.metadata.has_icc, true);
    push_kv_bool(&mut out, "hasComments", report.metadata.has_comments, true);
    push_kv_bool(&mut out, "hasPrivacyRisk", report.metadata.has_privacy_risk(), true);
    push_kv_usize(&mut out, "metadataBytes", report.metadata.metadata_bytes, true);
    push_kv_opt_str(&mut out, "cameraMake", report.metadata.camera_make.as_deref(), true);
    push_kv_opt_str(&mut out, "cameraModel", report.metadata.camera_model.as_deref(), true);
    push_kv_opt_str(&mut out, "software", report.metadata.software.as_deref(), true);
    push_kv_opt_str(&mut out, "dateTime", report.metadata.date_time.as_deref(), true);

    out.push_str(",\"tagsFound\":[");
    for (idx, tag) in report.metadata.tags_found.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        push_escaped_str(&mut out, tag);
    }
    out.push(']');

    out.push('}');
    out
}

fn push_kv_str(out: &mut String, key: &str, val: &str, comma: bool) {
    if comma {
        out.push(',');
    }
    push_escaped_str(out, key);
    out.push(':');
    push_escaped_str(out, val);
}

fn push_kv_opt_str(out: &mut String, key: &str, val: Option<&str>, comma: bool) {
    if comma {
        out.push(',');
    }
    push_escaped_str(out, key);
    out.push(':');
    match val {
        Some(s) => push_escaped_str(out, s),
        None => out.push_str("null"),
    }
}

fn push_kv_usize(out: &mut String, key: &str, val: usize, comma: bool) {
    if comma {
        out.push(',');
    }
    push_escaped_str(out, key);
    out.push(':');
    out.push_str(&val.to_string());
}

fn push_kv_opt_u32(out: &mut String, key: &str, val: Option<u32>, comma: bool) {
    if comma {
        out.push(',');
    }
    push_escaped_str(out, key);
    out.push(':');
    match val {
        Some(n) => out.push_str(&n.to_string()),
        None => out.push_str("null"),
    }
}

fn push_kv_bool(out: &mut String, key: &str, val: bool, comma: bool) {
    if comma {
        out.push(',');
    }
    push_escaped_str(out, key);
    out.push(':');
    out.push_str(if val { "true" } else { "false" });
}

fn push_escaped_str(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                use core::fmt::Write;
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}
