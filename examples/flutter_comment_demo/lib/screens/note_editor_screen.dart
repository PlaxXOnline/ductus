import 'package:flutter/material.dart';

// @journey:screen id="note-editor" title="Notiz-Editor" flow="notes"
//   description="Formular zum Anlegen oder Bearbeiten einer Notiz mit Titel und Inhalt."
class NoteEditorScreen extends StatelessWidget {
  const NoteEditorScreen({super.key});

  // @journey:decision id="save-check" title="Eingaben gültig?" flow="notes"
  //   description="Beim Speichern wird geprüft, ob die Notiz einen Titel hat."
  // @journey:action label="Zurück zur Liste"
  //   from="save-check" to="note-list" trigger="auto"
  //   condition="Titel vorhanden"
  // @journey:action label="Fehlerhinweis anzeigen"
  //   from="save-check" to="note-editor" trigger="auto"
  //   condition="Titel fehlt"
  void _save(BuildContext context, String title) {
    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Bitte einen Titel eingeben.')),
      );
      return;
    }
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final titleController = TextEditingController();
    return Scaffold(
      appBar: AppBar(title: const Text('Notiz bearbeiten')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              controller: titleController,
              decoration: const InputDecoration(labelText: 'Titel'),
            ),
            const TextField(
              decoration: InputDecoration(labelText: 'Inhalt'),
              maxLines: 5,
            ),
            const SizedBox(height: 16),
            // @journey:action label="Speichern"
            //   from="note-editor" to="save-check" trigger="submit"
            FilledButton(
              onPressed: () => _save(context, titleController.text),
              child: const Text('Speichern'),
            ),
          ],
        ),
      ),
    );
  }
}
