# Local panels in Apps

Open Apps → Local panels and select a JSON file. Each file contributes up to eight tables of text for the current Apps view. Select the same ID again to replace its tables. Closing the view clears imported panels. Panel files stay on the device.

```json
{
  "manifestVersion": 2,
  "pluginApi": 1,
  "execution": "sandboxed-ui",
  "id": "delivery",
  "name": "Delivery",
  "version": "1.0.0",
  "capabilities": [],
  "contributes": {
    "panels": [{
      "id": "queue", "title": "Delivery queue", "ui": "static",
      "rows": [{ "label": "Waiting", "value": "3" }]
    }]
  }
}
```

This static subset accepts no executable entry, URL, file permission, host API, or worker. Data is rendered as text. Each file is limited to 64 KiB. The plugin ID rules are copied from Orca under the MIT license distributed with StartupBot.
