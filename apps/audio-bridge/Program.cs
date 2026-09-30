// See https://aka.ms/new-console-template for more information
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;

const int SampleRate = 48_000;
const int Channels = 2;
const int BufferMilliseconds = 20;

var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);

if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
{
    Console.Error.WriteLine("TELAE_ERROR Windows 10 2004 (build 19041) ou superior e necessario.");
    return 2;
}

if (args.Length == 0)
{
    PrintUsage();
    return 1;
}

try
{
    switch (args[0].ToLowerInvariant())
    {
        case "list":
            Console.WriteLine(JsonSerializer.Serialize(ListProcesses(), jsonOptions));
            return 0;

        case "capture":
            var processId = ParseProcessId(args);
            await CaptureProcessAsync(processId);
            return 0;

        case "resolve-window":
            if (args.Length < 2 || !long.TryParse(args[1], out var handle) || handle <= 0)
                throw new ArgumentException("Informe o identificador da janela.");
            NativeMethods.GetWindowThreadProcessId(new IntPtr(handle), out var windowProcessId);
            if (windowProcessId == 0) throw new InvalidOperationException("Não foi possível identificar o aplicativo desta janela.");
            Console.WriteLine(windowProcessId);
            return 0;

        default:
            PrintUsage();
            return 1;
    }
}
catch (OperationCanceledException)
{
    return 0;
}
catch (Exception exception)
{
    Console.Error.WriteLine($"TELAE_ERROR {exception.Message}");
    return 3;
}

static IReadOnlyList<AudioProcessInfo> ListProcesses()
{
    var result = new List<AudioProcessInfo>();

    foreach (var process in Process.GetProcesses())
    {
        using (process)
        {
            try
            {
                if (process.Id <= 4 || process.Id == Environment.ProcessId || process.HasExited)
                    continue;

                var processName = process.ProcessName;
                if (string.IsNullOrWhiteSpace(processName))
                    continue;

                var title = process.MainWindowTitle;
                if (process.MainWindowHandle == IntPtr.Zero && string.IsNullOrWhiteSpace(title))
                    continue;

                result.Add(new AudioProcessInfo(process.Id, processName, title));
            }
            catch
            {
                // Protected/system processes are intentionally omitted from the picker.
            }
        }
    }

    return result
        .GroupBy(item => item.ProcessId)
        .Select(group => group.First())
        .OrderBy(item => string.IsNullOrWhiteSpace(item.WindowTitle) ? item.ProcessName : item.WindowTitle)
        .ThenBy(item => item.ProcessName)
        .ToArray();
}

static int ParseProcessId(string[] commandLine)
{
    var pidIndex = Array.FindIndex(commandLine, value => string.Equals(value, "--pid", StringComparison.OrdinalIgnoreCase));
    if (pidIndex < 0 || pidIndex + 1 >= commandLine.Length || !int.TryParse(commandLine[pidIndex + 1], out var pid) || pid <= 0)
        throw new ArgumentException("Use: Telae.AudioBridge capture --pid <processId>");

    return pid;
}

static async Task CaptureProcessAsync(int processId)
{
    using var target = Process.GetProcessById(processId);
    if (target.HasExited)
        throw new InvalidOperationException("O aplicativo selecionado ja foi encerrado.");

    var builder = new WasapiRecorderBuilder()
        .WithSharedMode()
        .WithProcessLoopback((uint)processId, ProcessLoopbackMode.IncludeTargetProcessTree)
        .WithFormat(WaveFormat.CreateIeeeFloatWaveFormat(SampleRate, Channels))
        .WithBufferLength(BufferMilliseconds)
        .WithMmcssThreadPriority("Audio");

    using var recorder = await builder.BuildAsync();
    await using var stdout = Console.OpenStandardOutput();
    using var cancellation = new CancellationTokenSource();

    Console.CancelKeyPress += (_, eventArgs) =>
    {
        eventArgs.Cancel = true;
        cancellation.Cancel();
    };

    var metadata = new AudioStreamMetadata(
        ProcessId: processId,
        SampleRate: SampleRate,
        Channels: Channels,
        SampleFormat: "f32le");

    Console.Error.WriteLine($"TELAE_FORMAT {JsonSerializer.Serialize(metadata, new JsonSerializerOptions(JsonSerializerDefaults.Web))}");
    var monitorTask = MonitorProcessAsync(target, cancellation);

    try
    {
        await foreach (var audioBuffer in recorder.CaptureAsync(cancellation.Token))
        {
            await stdout.WriteAsync(audioBuffer.Data, cancellation.Token);
            await stdout.FlushAsync(cancellation.Token);
        }
    }
    catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
    {
    }
    finally
    {
        cancellation.Cancel();
        await monitorTask;
    }
}

static async Task MonitorProcessAsync(Process target, CancellationTokenSource cancellation)
{
    try
    {
        while (!cancellation.IsCancellationRequested && !target.HasExited)
            await Task.Delay(250, cancellation.Token);
    }
    catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
    {
    }

    if (!cancellation.IsCancellationRequested)
        cancellation.Cancel();
}

static void PrintUsage()
{
    Console.Error.WriteLine("Telae.AudioBridge list");
    Console.Error.WriteLine("Telae.AudioBridge capture --pid <processId>");
}

internal sealed record AudioProcessInfo(int ProcessId, string ProcessName, string WindowTitle);
internal sealed record AudioStreamMetadata(int ProcessId, int SampleRate, int Channels, string SampleFormat);

internal static class NativeMethods
{
    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
