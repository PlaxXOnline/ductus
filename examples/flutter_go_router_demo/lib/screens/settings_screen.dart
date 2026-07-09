import 'package:flutter/material.dart';

// Bewusst NICHT annotiert: Dieser Screen entsteht ausschließlich
// aus der go_router-Ableitung (Weg C).
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      title: const Text('Benachrichtigungen'),
      value: true,
      onChanged: (_) {},
    );
  }
}
