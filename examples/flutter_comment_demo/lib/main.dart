import 'package:flutter/material.dart';

import 'screens/note_list_screen.dart';

// @journey:flow id="notes" title="Notizen verwalten" start="note-list"
//   description="Notizen anlegen, lesen, bearbeiten und die App einstellen."

void main() => runApp(const CommentDemoApp());

class CommentDemoApp extends StatelessWidget {
  const CommentDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      title: 'Ductus Kommentar-Demo',
      home: NoteListScreen(),
    );
  }
}
