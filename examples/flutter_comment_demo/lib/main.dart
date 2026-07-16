import 'package:flutter/material.dart';

import 'screens/note_list_screen.dart';

// @journey:flow id="notes" title="Manage notes" start="note-list"
//   description="Create, read and edit notes, and adjust the app settings."

void main() => runApp(const CommentDemoApp());

class CommentDemoApp extends StatelessWidget {
  const CommentDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      title: 'Ductus Comment Demo',
      home: NoteListScreen(),
    );
  }
}
