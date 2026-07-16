import 'package:flutter/material.dart';

import 'note_detail_screen.dart';
import 'note_editor_screen.dart';
import 'settings_screen.dart';

// @journey:screen id="note-list" title="Note list" flow="notes"
//   description="Home screen showing all saved notes in a list."
class NoteListScreen extends StatelessWidget {
  const NoteListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notes'),
        actions: [
          // @journey:action label="Open settings"
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
          // @journey:action label="Open note"
          //   from="note-list" to="note-detail" trigger="tap"
          ListTile(
            title: const Text('Shopping list'),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => const NoteDetailScreen(title: 'Shopping list'),
              ),
            ),
          ),
        ],
      ),
      // @journey:action label="New note"
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
