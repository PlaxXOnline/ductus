import 'package:flutter/material.dart';

// @journey:screen id="settings" title="Settings" flow="notes"
//   description="App settings, e.g. the color scheme."
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: SwitchListTile(
        title: const Text('Dark theme'),
        value: false,
        onChanged: (_) {},
      ),
      // @journey:action label="Back"
      //   from="settings" to="note-list" trigger="back"
    );
  }
}
