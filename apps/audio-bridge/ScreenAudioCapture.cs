using System.Runtime.InteropServices;
using System.Text.Json;
using NAudio.CoreAudioApi;
using NAudio.Wave;

// Process loopback exclusion applies to a complete Electron process tree, including
// Discord's background audio processes. Never fall back to unfiltered device audio.
internal static class ScreenAudioCapture
{
    internal static async Task RunAsync(Func<uint[]>? findRoots = null)
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 20348))
            throw new PlatformNotSupportedException("O filtro de áudio requer Windows 11 ou Windows build 20348 ou superior.");

        using var cancellation = new CancellationTokenSource();
        findRoots ??= () => DiscordProcesses.FindRoots();
        var currentRoots = findRoots();
        Exception? monitorFailure = null;
        var monitor = Task.Run(async () =>
        {
            try
            {
                while (!cancellation.IsCancellationRequested)
                {
                    await Task.Delay(100, cancellation.Token);
                    Volatile.Write(ref currentRoots, findRoots());
                }
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
            catch (Exception error) { Volatile.Write(ref monitorFailure, error); }
        });
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; cancellation.Cancel(); };
        await using var output = Console.OpenStandardOutput();
        var silence = new byte[960 * 2 * sizeof(float)];
        var metadataSent = false;
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                if (Volatile.Read(ref monitorFailure) is { } failure) throw failure;
                var roots = Volatile.Read(ref currentRoots);
                // Windows excludes one tree per recorder. With independent Discord
                // installations running together, silence is safer than leaking a call.
                if (roots.Length > 1)
                {
                    SendMetadata();
                    await output.WriteAsync(silence, cancellation.Token);
                    await output.FlushAsync(cancellation.Token);
                    await Task.Delay(20, cancellation.Token);
                    continue;
                }

                var excluded = roots.Length == 1 ? roots[0] : (uint)Environment.ProcessId;
                using var recorder = await new WasapiRecorderBuilder()
                    .WithSharedMode()
                    .WithProcessLoopback(excluded, ProcessLoopbackMode.ExcludeTargetProcessTree)
                    .WithFormat(WaveFormat.CreateIeeeFloatWaveFormat(48_000, 2))
                    .WithBufferLength(20)
                    .WithMmcssThreadPriority("Audio")
                    .BuildAsync();
                SendMetadata();
                await foreach (var buffer in recorder.CaptureAsync(cancellation.Token))
                {
                    // React to observed tree changes before forwarding more audio.
                    if (Volatile.Read(ref monitorFailure) is { } error) throw error;
                    if (!roots.SequenceEqual(Volatile.Read(ref currentRoots))) break;
                    await output.WriteAsync(buffer.Data, cancellation.Token);
                    await output.FlushAsync(cancellation.Token);
                }
            }
        }
        finally
        {
            cancellation.Cancel();
            await monitor;
        }

        void SendMetadata()
        {
            if (metadataSent) return;
            metadataSent = true;
            Console.Error.WriteLine("TELAE_FORMAT " + JsonSerializer.Serialize(
                new AudioStreamMetadata(0, 48_000, 2, "f32le"),
                new JsonSerializerOptions(JsonSerializerDefaults.Web)));
        }
    }
}

internal static class DiscordProcesses
{
    internal static uint[] FindRoots(string[]? names = null)
    {
        names ??= ["Discord", "DiscordPTB", "DiscordCanary", "DiscordDevelopment"];
        var snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1))
            throw new InvalidOperationException("Não foi possível verificar o filtro de áudio do Discord.");
        try
        {
            var processes = new Dictionary<uint, uint>();
            var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf<ProcessEntry>(), ExeFile = "" };
            if (!Process32First(snapshot, ref entry))
                throw new InvalidOperationException("Não foi possível listar os aplicativos para filtrar o áudio.");
            do
            {
                var name = Path.GetFileNameWithoutExtension(entry.ExeFile);
                if (names.Contains(name, StringComparer.OrdinalIgnoreCase))
                    processes[entry.ProcessId] = entry.ParentProcessId;
            } while (Process32Next(snapshot, ref entry));
            if (Marshal.GetLastWin32Error() != 18) // ERROR_NO_MORE_FILES
                throw new InvalidOperationException("A verificação do filtro de áudio foi interrompida.");
            return processes.Where(p => !processes.ContainsKey(p.Value))
                .Select(p => p.Key).Order().ToArray();
        }
        finally { CloseHandle(snapshot); }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        public uint Size, Usage, ProcessId;
        public UIntPtr DefaultHeapId;
        public uint ModuleId, Threads, ParentProcessId;
        public int BasePriority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string ExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}
