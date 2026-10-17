/**
 * Security test: podcast audio synthesis must pass LLM-derived text to edge-tts as a plain
 * argument, never through a shell. Also checks that each host is voiced separately.
 */

import * as fs from "fs";
import * as path from "path";

const mockExecFileSync = jest.fn();
jest.mock("child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  execSync: () => {
    throw new Error("execSync (shell) must not be used");
  },
}));

import { generatePodcast } from "../src/publishing/podcast_generator";

describe("podcast audio synthesis", () => {
  const tmpDir = path.join(process.cwd(), "_tmp_ai", "test_podcast_exec");

  beforeEach(() => {
    mockExecFileSync.mockReset();
    // Emulate edge-tts: write a fake MP3 segment to the --write-media path.
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      const out = args.indexOf("--write-media");
      if (out >= 0) fs.writeFileSync(args[out + 1]!, Buffer.from("ID3"));
      return Buffer.from("");
    });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("passes shell metacharacters to edge-tts as a literal argument", async () => {
    const payload = '$(touch /tmp/pwned); echo "quoted" \\';
    const summary = `## 🔥 本日の最重要ニュース\n\n### 注目トピック ${payload}\n\n---\n`;

    const result = await generatePodcast(summary, "2026-10-01", { outputDir: tmpDir, language: "ja" });

    expect(result.status).toBe("synthesized");
    const synthesisCall = mockExecFileSync.mock.calls.find(([, args]) => {
      const a = args as string[];
      return a.includes("--text") && a[a.indexOf("--text") + 1]!.includes(payload);
    });
    expect(synthesisCall).toBeDefined();
    const [command, , options] = synthesisCall as [string, string[], { shell?: unknown }];
    expect(command).toBe("edge-tts");
    expect(options.shell).toBeUndefined();
  });

  test("uses one voice per host and joins the segments into one MP3", async () => {
    const result = await generatePodcast("## 🔥 Top\n\n### Title\n\nBody.", "2026-10-02", {
      outputDir: tmpDir,
      language: "en",
      voices: { en: { host_a: "voice-a", host_b: "voice-b" } },
    });

    expect(result.status).toBe("synthesized");
    const voices = mockExecFileSync.mock.calls
      .map(([, args]) => args as string[])
      .filter((a) => a.includes("--voice"))
      .map((a) => a[a.indexOf("--voice") + 1]);
    expect(new Set(voices)).toEqual(new Set(["voice-a", "voice-b"]));
    expect(fs.readFileSync(result.audioPath!).length).toBe(3 * voices.length);
    expect(fs.existsSync(`${result.audioPath}.parts`)).toBe(false);
  });
});
