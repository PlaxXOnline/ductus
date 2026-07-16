import 'package:flutter/material.dart';

// Deliberately NOT annotated: this screen exists solely through
// the go_router derivation (path C).
class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(child: Text('Welcome to the dashboard'));
  }
}
