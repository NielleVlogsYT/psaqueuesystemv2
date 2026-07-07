using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace PsaQueueLauncher
{
    internal static class Program
    {
        private const string DefaultHost = "localhost";
        private const string DefaultPort = "3000";

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                LauncherMode mode = DetectMode();
                string url = ResolveUrl(args, mode);
                Rectangle targetScreen = ResolveTargetScreen(mode);

                LaunchBrowser(url, targetScreen);
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Unable to launch the PSA Queuing page." + Environment.NewLine + Environment.NewLine + ex.Message,
                    "PSA Queuing Launcher",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 1;
            }
        }

        private static LauncherMode DetectMode()
        {
            string executableName = Path.GetFileNameWithoutExtension(Application.ExecutablePath).ToLowerInvariant();

            if (executableName.Contains("second") ||
                executableName.Contains("monitor") ||
                executableName.Contains("display"))
            {
                return LauncherMode.Display;
            }

            return LauncherMode.Browser;
        }

        private static string ResolveUrl(string[] args, LauncherMode mode)
        {
            string page = mode == LauncherMode.Display ? "queue_Status.html" : "login.html";
            string configuredTarget = FirstNonEmpty(
                FirstArgument(args),
                ReadConfigFile(),
                Environment.GetEnvironmentVariable(mode == LauncherMode.Display ? "PSA_QUEUE_DISPLAY_URL" : "PSA_QUEUE_BROWSER_URL"),
                Environment.GetEnvironmentVariable("PSA_QUEUE_URL"),
                Environment.GetEnvironmentVariable("PSA_QUEUE_HOST"),
                DefaultHost);

            return BuildUrl(configuredTarget, page);
        }

        private static string FirstArgument(string[] args)
        {
            if (args == null || args.Length == 0)
            {
                return null;
            }

            return args[0];
        }

        private static string ReadConfigFile()
        {
            string directory = AppDomain.CurrentDomain.BaseDirectory;
            string executableName = Path.GetFileNameWithoutExtension(Application.ExecutablePath);
            string[] candidates =
            {
                Path.Combine(directory, executableName + ".url.txt"),
                Path.Combine(directory, "psa-queuing.url.txt"),
                Path.Combine(directory, "psa-queue.url.txt")
            };

            foreach (string path in candidates)
            {
                if (!File.Exists(path))
                {
                    continue;
                }

                foreach (string rawLine in File.ReadAllLines(path))
                {
                    string line = rawLine.Trim();
                    if (line.Length > 0 && !line.StartsWith("#", StringComparison.Ordinal))
                    {
                        return line;
                    }
                }
            }

            return null;
        }

        private static string FirstNonEmpty(params string[] values)
        {
            foreach (string value in values)
            {
                if (!string.IsNullOrWhiteSpace(value))
                {
                    return value.Trim();
                }
            }

            return DefaultHost;
        }

        private static string BuildUrl(string configuredTarget, string page)
        {
            string target = configuredTarget.Trim();

            if (target.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                target.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                return AppendPageIfNeeded(target, page);
            }

            if (target.IndexOf('/') >= 0)
            {
                return AppendPageIfNeeded("http://" + target, page);
            }

            if (target.IndexOf(':') < 0)
            {
                target = target + ":" + DefaultPort;
            }

            return "http://" + target + "/" + page;
        }

        private static string AppendPageIfNeeded(string url, string page)
        {
            Uri uri;
            if (!Uri.TryCreate(url, UriKind.Absolute, out uri))
            {
                return url;
            }

            if (string.IsNullOrEmpty(uri.AbsolutePath) || uri.AbsolutePath == "/")
            {
                return url.TrimEnd('/') + "/" + page;
            }

            return url;
        }

        private static Rectangle ResolveTargetScreen(LauncherMode mode)
        {
            Screen fallback = Screen.PrimaryScreen;

            if (mode == LauncherMode.Display)
            {
                foreach (Screen screen in Screen.AllScreens)
                {
                    if (!screen.Primary)
                    {
                        return screen.Bounds;
                    }
                }
            }

            return fallback.Bounds;
        }

        private static void LaunchBrowser(string url, Rectangle targetScreen)
        {
            string browserPath = FindBrowser();

            if (browserPath == null)
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
                return;
            }

            string arguments =
                "--new-window --start-fullscreen --no-first-run " +
                "--window-position=" + targetScreen.X + "," + targetScreen.Y + " " +
                "--window-size=" + targetScreen.Width + "," + targetScreen.Height + " " +
                Quote(url);

            Process.Start(new ProcessStartInfo
            {
                FileName = browserPath,
                Arguments = arguments,
                UseShellExecute = false
            });
        }

        private static string FindBrowser()
        {
            string configuredBrowser = Environment.GetEnvironmentVariable("PSA_QUEUE_BROWSER_PATH");
            if (!string.IsNullOrWhiteSpace(configuredBrowser) && File.Exists(configuredBrowser))
            {
                return configuredBrowser;
            }

            string[] candidates =
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe"),
                FindOnPath("chrome.exe"),
                FindOnPath("msedge.exe")
            };

            foreach (string candidate in candidates)
            {
                if (!string.IsNullOrWhiteSpace(candidate) && File.Exists(candidate))
                {
                    return candidate;
                }
            }

            return null;
        }

        private static string FindOnPath(string fileName)
        {
            string pathValue = Environment.GetEnvironmentVariable("PATH");
            if (string.IsNullOrWhiteSpace(pathValue))
            {
                return null;
            }

            foreach (string directory in pathValue.Split(Path.PathSeparator))
            {
                try
                {
                    string candidate = Path.Combine(directory.Trim(), fileName);
                    if (File.Exists(candidate))
                    {
                        return candidate;
                    }
                }
                catch
                {
                    // Ignore malformed PATH entries.
                }
            }

            return null;
        }

        private static string Quote(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private enum LauncherMode
        {
            Browser,
            Display
        }
    }
}
