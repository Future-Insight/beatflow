const SIZE_WARN_MB = 30;

export function mustPickSingleFile(inputEl) {
  const files = inputEl?.files;
  if (!files || files.length === 0) throw new Error("请选择音频文件");
  return files[0];
}

// 返回警告字符串；文件不超限则返回 null
export function warnIfLarge(file, limitMb = SIZE_WARN_MB) {
  if (!file) return null;
  const mb = file.size / (1024 * 1024);
  if (mb > limitMb) {
    return `文件较大（${mb.toFixed(1)} MB > ${limitMb} MB），上传可能需要较长时间`;
  }
  return null;
}
