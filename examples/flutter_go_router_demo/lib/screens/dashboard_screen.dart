import 'package:flutter/material.dart';

// Bewusst NICHT annotiert: Dieser Screen entsteht ausschließlich
// aus der go_router-Ableitung (Weg C).
class DashboardScreen extends StatelessWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(child: Text('Willkommen auf dem Dashboard'));
  }
}
