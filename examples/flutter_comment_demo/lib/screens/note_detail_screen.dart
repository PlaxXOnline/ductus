import 'package:flutter/material.dart';

import 'note_editor_screen.dart';

// @journey:screen id="note-detail" title="Note detail" flow="notes"
//   description="Shows the full content of a single note."
class NoteDetailScreen extends StatelessWidget {
  const NoteDetailScreen({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          // @journey:action label="Edit note"
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
        child: Text('Milk, bread, eggs'),
      ),
    );
  }
}
