using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class StartupBotPrivateDesktop {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct StartupInfo {
    public int cb;
    public string reserved, desktop, title;
    public int x,y,xSize,ySize,xCount,yCount,fill,flags;
    public short show,reserved2;
    public IntPtr data, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo { public IntPtr process, thread; public int pid, tid; }

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr attributes);
  [DllImport("user32.dll", SetLastError=true)]
  static extern bool CloseDesktop(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool CreateProcess(string app, System.Text.StringBuilder args, IntPtr procAttrs, IntPtr threadAttrs,
    bool inherit, uint flags, IntPtr env, string directory, ref StartupInfo info, out ProcessInfo child);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetExitCodeProcess(IntPtr h, out int code);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool TerminateProcess(IntPtr h, uint code);

  public static int Main(string[] args) {
    if (args.Length != 3) {
      Console.Error.WriteLine("Expected paths to Node, the qualification entry, and the log");
      return 2;
    }
    foreach (string path in args) {
      if (!System.IO.Path.IsPathRooted(path) || path.IndexOf('"') >= 0) return 2;
    }
    try {
      Environment.SetEnvironmentVariable("OMB_CUA_ISOLATED_DESKTOP", "1");
      string arg = "\"" + args[1] + "\" \"" + args[2] + "\"";
      return Run(args[0], arg, System.IO.Path.GetDirectoryName(args[1]));
    } catch (Exception e) {
      Console.Error.WriteLine(e.Message);
      return 1;
    }
  }

  static int Run(string exe, string args, string directory) {
    string name = "StartupBotRpa_" + Guid.NewGuid().ToString("N");
    IntPtr desktop = CreateDesktop(name, IntPtr.Zero, IntPtr.Zero, 0, 0x01FF, IntPtr.Zero);
    if (desktop == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateDesktop failed");
    try {
      var info = new StartupInfo { cb = Marshal.SizeOf(typeof(StartupInfo)), desktop = name };
      ProcessInfo child;
      if (!CreateProcess(exe, new System.Text.StringBuilder("\"" + exe + "\" " + args), IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, directory, ref info, out child))
        throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess on private desktop failed");
      try {
        if (WaitForSingleObject(child.process, 120000) != 0) {
          TerminateProcess(child.process, 1);
          throw new TimeoutException("Private desktop qualification timed out");
        }
        int code;
        if (!GetExitCodeProcess(child.process, out code)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return code;
      } finally { CloseHandle(child.thread); CloseHandle(child.process); }
    } finally { CloseDesktop(desktop); }
  }
}
