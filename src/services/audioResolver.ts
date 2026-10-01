import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
const execFileAsync = promisify(execFile);
const ytDlpCookiePath = "/tmp/youtube-cookies.txt";

function ytDlpCookies(): string[] {
  const encoded = process.env.YTDLP_COOKIES_BASE64;
  if (!encoded) return [];
  writeFileSync(ytDlpCookiePath, Buffer.from(encoded, "base64"), { mode: 0o600 });
  return ["--cookies", ytDlpCookiePath];
}

export async function resolveYtDlpAudio(id: string): Promise<{ url: string; type: string }> {
  // YouTube does not offer identical formats to every Innertube client. In
  // particular, the default web client can reject an otherwise valid signed-in
  // session with “page needs to be reloaded”. Try the TV embedded client first,
  // then Android VR, both of which return ordinary audio streams.
  let lastError: unknown;
  for (const client of ["tv_embedded", "android_vr"]) {
    try {
      const { stdout } = await execFileAsync("yt-dlp", [
        ...ytDlpCookies(),
        "--no-playlist",
        "--no-warnings",
        "--extractor-args", `youtube:player_client=${client}`,
        "-f", "bestaudio/best",
        "--print", "%(url)s\t%(ext)s",
        `https://www.youtube.com/watch?v=${id}`,
      ], { timeout: 25_000, maxBuffer: 128 * 1024 });
      const [url, extension] = stdout.trim().split(/\r?\n/)[0].split("\t");
      if (!url?.startsWith("http")) throw new Error("yt-dlp did not return an audio URL");
      return { url, type: extension === "m4a" || extension === "mp4" ? "audio/mp4" : "audio/webm" };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("yt-dlp could not resolve an audio URL");
}
