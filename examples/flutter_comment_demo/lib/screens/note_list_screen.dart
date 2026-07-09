import 'package:flutter/material.dart';

import 'note_detail_screen.dart';
import 'note_editor_screen.dart';
import 'settings_screen.dart';

// @journey:screen id="note-list" title="Notizliste" flow="notes"
//   description="Startbildschirm mit allen gespeicherten Notizen in einer Liste."
class NoteListScreen extends StatelessWidget {
  const NoteListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notizen'),
        actions: [
          // @journey:action label="Einstellungen öffnen"
          //   from="note-list" to="settings" trigger="tap"
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SettingsScreen()),
            ),
          ),
        ],
      ),
      body: ListView(
        children: [
          // @journey:action label="Notiz öffnen"
          //   from="note-list" to="note-detail" trigger="tap"
          ListTile(
            title: const Text('Einkaufsliste'),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const NoteDetailScreen(title: 'Einkaufsliste'),
              ),
            ),
          ),
        ],
      ),
      // @journey:action label="Neue Notiz"
      //   from="note-list" to="note-editor" trigger="tap"
      floatingActionButton: FloatingActionButton(
        onPressed: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const NoteEditorScreen()),
        ),
        child: const Icon(Icons.add),
      ),
    );
  }
}
