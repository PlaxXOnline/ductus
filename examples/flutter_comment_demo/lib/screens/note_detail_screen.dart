import 'package:flutter/material.dart';

import 'note_editor_screen.dart';

// @journey:screen id="note-detail" title="Notiz-Detail" flow="notes"
//   description="Zeigt den vollständigen Inhalt einer einzelnen Notiz an."
class NoteDetailScreen extends StatelessWidget {
  const NoteDetailScreen({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          // @journey:action label="Notiz bearbeiten"
          //   from="note-detail" to="note-editor" trigger="tap"
          IconButton(
            icon: const Icon(Icons.edit),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const NoteEditorScreen()),
            ),
          ),
        ],
      ),
      body: const Padding(
        padding: EdgeInsets.all(16),
        child: Text('Milch, Brot, Eier'),
      ),
    );
  }
}
