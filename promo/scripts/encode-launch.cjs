const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
const artifacts = path.join(root, "tests/e2e/.artifacts/promo-reference");
fs.mkdirSync(artifacts, { recursive: true });
let ffmpeg = process.env.LAUNCH_FFMPEG || "ffmpeg";
let binaryDirectory;
if (!process.env.LAUNCH_FFMPEG) {
  try {
    binaryDirectory = require(`@remotion/compositor-${process.platform}-${process.arch}`).dir;
    ffmpeg = path.join(binaryDirectory, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  } catch {}
}

for (const name of ["launch-promo.mp4", "hero-editor-loop.mp4"]) {
  const source = path.join(root, "website/assets/video", name);
  const output = path.join(artifacts, `web-${name}`);
  const hero = name === "hero-editor-loop.mp4";
  const args = [
    "-hide_banner", "-loglevel", "error", "-y", "-i", source,
    "-t", hero ? "10" : "32",
    "-vf", "scale=in_range=auto:out_range=tv,format=yuv420p",
    "-c:v", "libx264", "-preset", "slow", "-crf", hero ? "25" : "21",
    ...(hero ? ["-maxrate", "2100k", "-bufsize", "4200k", "-an"] : ["-c:a", "copy"]),
    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-movflags", "+faststart", output,
  ];
  execFileSync(ffmpeg, args, {
    env: { ...process.env, ...(binaryDirectory ? { DYLD_LIBRARY_PATH: binaryDirectory } : {}) },
    stdio: "inherit",
  });
  fs.renameSync(output, source);
  console.log(`${name}: ${(fs.statSync(source).size / 1048576).toFixed(2)} MB`);
}
