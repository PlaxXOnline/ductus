import 'package:flutter/material.dart';

// @journey:screen id="settings" title="Einstellungen" flow="notes"
//   description="Einstellungen der App, z. B. das Farbschema."
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Einstellungen')),
      body: SwitchListTile(
        title: const Text('Dunkles Design'),
        value: false,
        onChanged: (_) {},
      ),
      // @journey:action label="Zurück"
      //   from="settings" to="note-list" trigger="back"
    );
  }
}
