import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/state/game_provider.dart';
import '../core/theme/roomie_theme.dart';
import '../models/game_state.dart';
import 'drawing_canvas.dart';

class DrawGuessGameView extends ConsumerStatefulWidget {
  const DrawGuessGameView({super.key, required this.roomId, required this.envelope});
  final String roomId;
  final GameStateEnvelope envelope;

  @override
  ConsumerState<DrawGuessGameView> createState() => _DrawGuessGameViewState();
}

class _DrawGuessGameViewState extends ConsumerState<DrawGuessGameView> {
  final _guessController = TextEditingController();

  @override
  void dispose() {
    _guessController.dispose();
    super.dispose();
  }

  Future<void> _submitGuess() async {
    final guess = _guessController.text.trim();
    if (guess.isEmpty) return;
    final result = await ref.read(gameControllerProvider.notifier).drawGuessSubmitGuess(widget.roomId, guess);
    if (result['correct'] == true) {
      _guessController.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.envelope.asDrawGuessState();

    if (state.winner != null || widget.envelope.phase == 'ended') {
      return _GameOverView(state: state);
    }

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ScoreStrip(state: state),
          const SizedBox(height: 12),
          if (widget.envelope.phase == 'word_selection' && state.isDrawer)
            _WordSelectionPrompt(roomId: widget.roomId, options: state.wordOptions ?? [])
          else if (widget.envelope.phase == 'word_selection')
            const Expanded(
              child: Center(
                child: Text('Waiting for the drawer to pick a word...', style: TextStyle(color: RoomieColors.textSecondary)),
              ),
            )
          else ...[
            if (state.isDrawer && state.currentWord != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text('Draw: ${state.currentWord}', style: Theme.of(context).textTheme.titleMedium),
              )
            else if (state.wordLength != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  List.filled(state.wordLength!, '_').join(' '),
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(letterSpacing: 4),
                ),
              ),
            Expanded(child: DrawingCanvas(roomId: widget.roomId, isDrawer: state.isDrawer)),
            if (!state.isDrawer && !state.hasGuessedCorrectly) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _guessController,
                      decoration: const InputDecoration(hintText: 'Type your guess...'),
                      onSubmitted: (_) => _submitGuess(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(onPressed: _submitGuess, icon: const Icon(Icons.send)),
                ],
              ),
            ] else if (state.hasGuessedCorrectly)
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'You guessed correctly! Waiting for the round to end...',
                  style: TextStyle(color: RoomieColors.success),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _ScoreStrip extends StatelessWidget {
  const _ScoreStrip({required this.state});
  final DrawGuessGameState state;

  @override
  Widget build(BuildContext context) {
    final entries = state.players.entries.toList()
      ..sort((a, b) => ((b.value as Map)['score'] as int).compareTo((a.value as Map)['score'] as int));

    return SizedBox(
      height: 36,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: entries.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final entry = entries[index];
          final score = (entry.value as Map)['score'];
          return Chip(
            label: Text('${entry.key}: $score', style: const TextStyle(fontSize: 12)),
            backgroundColor: entry.key == state.drawerId ? RoomieColors.accentMuted : RoomieColors.surfaceOverlay,
          );
        },
      ),
    );
  }
}

class _WordSelectionPrompt extends ConsumerWidget {
  const _WordSelectionPrompt({required this.roomId, required this.options});
  final String roomId;
  final List<String> options;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Expanded(
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text("It's your turn to draw! Pick a word:", style: TextStyle(color: RoomieColors.textSecondary)),
            const SizedBox(height: 16),
            ...options.map(
              (word) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: SizedBox(
                  width: 220,
                  child: ElevatedButton(
                    onPressed: () => ref.read(gameControllerProvider.notifier).drawGuessSelectWord(roomId, word),
                    child: Text(word),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GameOverView extends StatelessWidget {
  const _GameOverView({required this.state});
  final DrawGuessGameState state;

  @override
  Widget build(BuildContext context) {
    final entries = state.players.entries.toList()
      ..sort((a, b) => ((b.value as Map)['score'] as int).compareTo((a.value as Map)['score'] as int));

    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        children: [
          const Icon(Icons.emoji_events, size: 48, color: RoomieColors.warning),
          const SizedBox(height: 12),
          Text(
            state.winner != null ? '${state.winner} wins!' : "It's a tie!",
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 24),
          Expanded(
            child: ListView.builder(
              itemCount: entries.length,
              itemBuilder: (context, index) {
                final entry = entries[index];
                return ListTile(
                  leading: CircleAvatar(child: Text('${index + 1}')),
                  title: Text(entry.key),
                  trailing: Text('${(entry.value as Map)['score']} pts'),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
