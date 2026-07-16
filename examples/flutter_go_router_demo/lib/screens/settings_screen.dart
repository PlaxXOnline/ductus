import 'package:flutter/material.dart';

// Deliberately NOT annotated: this screen exists solely through
// the go_router derivation (path C).
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      title: const Text('Notifications'),
      value: true,
      onChanged: (_) {},
    );
  }
}
