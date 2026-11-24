export function isAcceptedImageFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|avif|gif|bmp|svg|ico)$/i.test(file.name);
}
