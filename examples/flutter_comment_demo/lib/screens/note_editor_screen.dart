import 'package:flutter/material.dart';

// @journey:screen id="note-editor" title="Note editor" flow="notes"
//   description="Form for creating or editing a note with a title and content."
class NoteEditorScreen extends StatelessWidget {
  const NoteEditorScreen({super.key});

  // @journey:decision id="save-check" title="Input valid?" flow="notes"
  //   description="On save, the app checks whether the note has a title."
  // @journey:action label="Back to the list"
  //   from="save-check" to="note-list" trigger="auto"
  //   condition="Title present"
  // @journey:action label="Show error message"
  //   from="save-check" to="note-editor" trigger="auto"
  //   condition="Title missing"
  void _save(BuildContext context, String title) {
    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter a title.')),
      );
      return;
    }
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final titleController = TextEditingController();
    return Scaffold(
      appBar: AppBar(title: const Text('Edit note')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              controller: titleController,
              decoration: const InputDecoration(labelText: 'Title'),
            ),
            const TextField(
              decoration: InputDecoration(labelText: 'Content'),
              maxLines: 5,
            ),
            const SizedBox(height: 16),
            // @journey:action label="Save"
            //   from="note-editor" to="save-check" trigger="submit"
            FilledButton(
              onPressed: () => _save(context, titleController.text),
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }
}
