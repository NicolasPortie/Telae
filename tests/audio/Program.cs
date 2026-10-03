using System.Diagnostics;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

if (args[0] == "roots")
{
    Console.WriteLine(string.Join(",", DiscordProcesses.FindRoots()));
    Console.WriteLine(string.Join(",", DiscordProcesses.FindRoots(["TelaeExcludedTone"])));
}
else if (args[0] == "capture")
{
    await ScreenAudioCapture.RunAsync(() => DiscordProcesses.FindRoots(["TelaeExcludedTone"]));
}
else if (args[0] == "parent")
{
    using var child = Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "tone 17789") { UseShellExecute = false, CreateNoWindow = true })!;
    try { await Task.Delay(Timeout.Infinite); }
    finally { if (!child.HasExited) child.Kill(); }
}
else
{
    using var player = new WasapiPlayerBuilder().WithSharedMode().Build();
    player.Init(new SignalGenerator(48_000, 2) { Type = SignalGeneratorType.Sin, Frequency = double.Parse(args[1]), Gain = .025 }.ToWaveProvider());
    player.Play();
    await Task.Delay(Timeout.Infinite);
}

internal sealed record AudioStreamMetadata(int ProcessId, int SampleRate, int Channels, string SampleFormat);
