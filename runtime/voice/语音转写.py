# -*- coding: utf-8 -*-
"""把一段音频转成文字（SenseVoice，本地 CPU）。

用法：python 语音转写.py <音频文件>
输出：一行文字；失败时非 0 退出。
支持：wav（任意采样率，内部重采样到 16k）；其它格式走 ffmpeg。
"""
import os
import sys
import tempfile
import wave

ROOT = r"W:\AI\DeepSeek小助手\video-agent"
PYLIBS = os.path.join(ROOT, "pylibs")
MODEL = os.path.join(ROOT, "models", "model.int8.onnx")
TOKENS = os.path.join(ROOT, "models", "tokens.txt")
TARGET_RATE = 16000

if PYLIBS not in sys.path:
    sys.path.insert(0, PYLIBS)
os.environ.setdefault("PYTHONUTF8", "1")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")


def ffmpeg_path():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def 读成16k单声道(src: str):
    """返回 (samples float32, rate)"""
    import numpy as np

    if src.lower().endswith(".wav"):
        with wave.open(src, "rb") as wf:
            ch, sw, rate, n = wf.getnchannels(), wf.getsampwidth(), wf.getframerate(), wf.getnframes()
            raw = wf.readframes(n)
        if sw != 2:
            raise ValueError("只支持 16bit wav，实际 %d" % sw)
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        if ch > 1:
            audio = audio.reshape(-1, ch).mean(axis=1)
        if rate != TARGET_RATE and len(audio) > 1:
            # 线性插值重采样
            k = TARGET_RATE / rate
            idx = np.arange(int(len(audio) * k)) / k
            i0 = np.floor(idx).astype(np.int64)
            i1 = np.minimum(i0 + 1, len(audio) - 1)
            frac = (idx - i0).astype(np.float32)
            audio = audio[i0] * (1 - frac) + audio[i1] * frac
            rate = TARGET_RATE
        return audio, rate

    # 其它格式：先用 ffmpeg 转
    out = os.path.join(tempfile.gettempdir(), "asr_" + str(os.getpid()) + ".wav")
    import subprocess
    subprocess.run([ffmpeg_path(), "-y", "-loglevel", "error", "-i", src, "-ar", str(TARGET_RATE), "-ac", "1", "-f", "wav", out], check=True)
    with wave.open(out, "rb") as wf:
        raw = wf.readframes(wf.getnframes())
    try:
        os.remove(out)
    except OSError:
        pass
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0, TARGET_RATE


def transcribe(src: str, language: str = "zh") -> str:
    import sherpa_onnx

    samples, rate = 读成16k单声道(src)
    kwargs = dict(model=MODEL, tokens=TOKENS, num_threads=4, use_itn=True, language=language)
    try:
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(**kwargs, debug=False)
    except TypeError:
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(**kwargs)
    stream = recognizer.create_stream()
    stream.accept_waveform(rate, samples)
    recognizer.decode_stream(stream)
    return (stream.result.text or "").strip()


def main():
    if len(sys.argv) < 2:
        print("用法: python 语音转写.py <音频文件>", file=sys.stderr)
        return 2
    src = sys.argv[1]
    if not os.path.exists(src):
        print("找不到文件: " + src, file=sys.stderr)
        return 3
    if not os.path.exists(MODEL):
        print("模型缺失: " + MODEL, file=sys.stderr)
        return 4
    text = transcribe(src)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
