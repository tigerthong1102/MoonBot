using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

static class NavigationFixture {
  [DllImport("kernel32.dll")]
  static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")]
  static extern IntPtr GetThreadDesktop(uint thread);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern bool GetUserObjectInformation(IntPtr handle, int index, StringBuilder data, uint capacity, out uint needed);

  [STAThread]
  static int Main(string[] args) {
    if (args.Length != 1 || !args[0].StartsWith("StartupBot CUA qualification ", StringComparison.Ordinal)) return 2;
    var desktop = new StringBuilder(256);
    uint needed;
    if (!GetUserObjectInformation(GetThreadDesktop(GetCurrentThreadId()), 2, desktop, 512, out needed)) return 3;
    // This check verifies inherited desktop isolation before the fixture creates any window.
    if (!desktop.ToString().StartsWith("StartupBotRpa_", StringComparison.Ordinal)) return 4;
    Application.EnableVisualStyles();
    using (var form = new Form { Text = args[0], AccessibleName = args[0], Width = 420, Height = 180 }) {
      var state = new TextBox {
        AccessibleName = "Fixture state", Text = "Before navigation", ReadOnly = true,
        Width = 300, Left = 16, Top = 16
      };
      var button = new Button {
        Text = "Navigate fixture", AccessibleName = "Navigate fixture", Width = 180, Left = 16, Top = 52
      };
      button.Click += delegate {
        state.Text = state.Text == "Before navigation" ? "After navigation" : "Unexpected second click";
        form.Text = args[0] + " - Destination";
        form.AccessibleName = form.Text;
      };
      form.Controls.Add(state);
      form.Controls.Add(button);
      using (var timer = new Timer { Interval = 25000 }) {
        timer.Tick += delegate { form.Close(); };
        timer.Start();
        Application.Run(form);
      }
    }
    return 0;
  }
}
