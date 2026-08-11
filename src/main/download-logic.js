'use strict';

function classifyError(raw) {
  const text = String(raw || '').toLowerCase();
  if (/sign in|login|cookies|authentication|required to log in/.test(text)) return 'AUTH_REQUIRED';
  if (/private video|private playlist/.test(text)) return 'VIDEO_PRIVATE';
  if (/video unavailable|has been removed|deleted/.test(text)) return 'VIDEO_UNAVAILABLE';
  if (/not available in your country|geo.?restrict/.test(text)) return 'GEO_BLOCKED';
  if (/no space left|disk full|not enough space/.test(text)) return 'DISK_FULL';
  if (/ffmpeg.*not found|ffprobe.*not found/.test(text)) return 'FFMPEG_MISSING';
  if (/requested format is not available|format.*not available/.test(text)) return 'FORMAT_UNAVAILABLE';
  if (/timed out|timeout|connection reset|network is unreachable|temporary failure/.test(text)) return 'NETWORK_ERROR';
  if (/unsupported url/.test(text)) return 'UNSUPPORTED_URL';
  return 'DOWNLOAD_FAILED';
}

function presetArgs(preset) {
  const compatibilityAudio = 'ba[ext=m4a]/ba';
  const compatibilityVideo = height =>
    `bv*[height<=${height}][ext=mp4][vcodec^=avc1]+${compatibilityAudio}/b[height<=${height}][ext=mp4]/bv*[height<=${height}]+ba/b[height<=${height}]`;

  switch (preset) {
    case 'mp4-2160': return ['-f', compatibilityVideo(2160), '--merge-output-format', 'mp4'];
    case 'mp4-1440': return ['-f', compatibilityVideo(1440), '--merge-output-format', 'mp4'];
    case 'mp4-1080': return ['-f', compatibilityVideo(1080), '--merge-output-format', 'mp4'];
    case 'mp4-720': return ['-f', compatibilityVideo(720), '--merge-output-format', 'mp4'];
    case 'audio-mp3': return ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0'];
    case 'audio-original': return ['-f', 'bestaudio/best', '-x'];
    case 'best':
    default: return ['-f', 'bv*+ba/b'];
  }
}

module.exports = { presetArgs, classifyError };
