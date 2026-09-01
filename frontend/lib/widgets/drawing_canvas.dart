import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/state/game_provider.dart';
import '../core/theme/roomie_theme.dart';

/// A stroke is a sequence of points plus color/width - the exact shape sent
/// over the wire via game:draw:stroke (see gameHandlers.js on the backend,
/// which relays this verbatim without interpreting it as game state).
class DrawStroke {
  DrawStroke({required this.points, required this.color, required this.strokeWidth});
  final List<Offset> points;
  final Color color;
  final double strokeWidth;

  Map<String, dynamic> toJson() => {
        'points': points.map((p) => {'x': p.dx, 'y': p.dy}).toList(),
        'color': color.value,
        'strokeWidth': strokeWidth,
      };

  static DrawStroke fromJson(Map<String, dynamic> json) {
    final pointsJson = (json['points'] as List<dynamic>).cast<Map<String, dynamic>>();
    return DrawStroke(
      points: pointsJson.map((p) => Offset((p['x'] as num).toDouble(), (p['y'] as num).toDouble())).toList(),
      color: Color(json['color'] as int),
      strokeWidth: (json['strokeWidth'] as num).toDouble(),
    );
  }
}

class DrawingCanvas extends ConsumerStatefulWidget {
  const DrawingCanvas({super.key, required this.roomId, required this.isDrawer});
  final String roomId;
  final bool isDrawer;

  @override
  ConsumerState<DrawingCanvas> createState() => _DrawingCanvasState();
}

class _DrawingCanvasState extends ConsumerState<DrawingCanvas> {
  final List<DrawStroke> _strokes = [];
  DrawStroke? _currentStroke;
  Color _selectedColor = Colors.white;
  final double _strokeWidth = 4;

  static const _palette = [
    Colors.white,
    Colors.red,
    Colors.orange,
    Colors.yellow,
    Colors.green,
    Colors.blue,
    Colors.purple,
  ];

  @override
  void initState() {
    super.initState();
    ref.read(gameControllerProvider.notifier).incomingStrokes.listen((data) {
      if (!mounted) return;
      setState(() => _strokes.add(DrawStroke.fromJson(Map<String, dynamic>.from(data['stroke'] as Map))));
    });
    ref.read(gameControllerProvider.notifier).clearEvents.listen((_) {
      if (mounted) setState(_strokes.clear);
    });
  }

  void _onPanStart(DragStartDetails details) {
    if (!widget.isDrawer) return;
    setState(() {
      _currentStroke = DrawStroke(points: [details.localPosition], color: _selectedColor, strokeWidth: _strokeWidth);
    });
  }

  void _onPanUpdate(DragUpdateDetails details) {
    if (!widget.isDrawer || _currentStroke == null) return;
    setState(() => _currentStroke!.points.add(details.localPosition));
  }

  void _onPanEnd(DragEndDetails details) {
    if (!widget.isDrawer || _currentStroke == null) return;
    final stroke = _currentStroke!;
    setState(() {
      _strokes.add(stroke);
      _currentStroke = null;
    });
    ref.read(gameControllerProvider.notifier).sendStroke(widget.roomId, stroke.toJson());
  }

  void _clear() {
    setState(_strokes.clear);
    ref.read(gameControllerProvider.notifier).sendClear(widget.roomId);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: Container(
            width: double.infinity,
            decoration: BoxDecoration(
              color: Colors.black,
              border: Border.all(color: RoomieColors.surfaceBorder),
              borderRadius: BorderRadius.circular(12),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: GestureDetector(
                onPanStart: _onPanStart,
                onPanUpdate: _onPanUpdate,
                onPanEnd: _onPanEnd,
                child: CustomPaint(
                  painter: _CanvasPainter(strokes: _strokes, currentStroke: _currentStroke),
                  size: Size.infinite,
                ),
              ),
            ),
          ),
        ),
        if (widget.isDrawer) ...[
          const SizedBox(height: 12),
          Row(
            children: [
              ..._palette.map(
                (color) => GestureDetector(
                  onTap: () => setState(() => _selectedColor = color),
                  child: Container(
                    margin: const EdgeInsets.only(right: 8),
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: color,
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: _selectedColor == color ? RoomieColors.accent : Colors.transparent,
                        width: 2,
                      ),
                    ),
                  ),
                ),
              ),
              const Spacer(),
              IconButton(onPressed: _clear, icon: const Icon(Icons.delete_outline)),
            ],
          ),
        ],
      ],
    );
  }
}

class _CanvasPainter extends CustomPainter {
  _CanvasPainter({required this.strokes, required this.currentStroke});
  final List<DrawStroke> strokes;
  final DrawStroke? currentStroke;

  @override
  void paint(Canvas canvas, Size size) {
    for (final stroke in [...strokes, if (currentStroke != null) currentStroke!]) {
      final paint = Paint()
        ..color = stroke.color
        ..strokeWidth = stroke.strokeWidth
        ..strokeCap = StrokeCap.round
        ..style = PaintingStyle.stroke;

      for (var i = 0; i < stroke.points.length - 1; i++) {
        canvas.drawLine(stroke.points[i], stroke.points[i + 1], paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _CanvasPainter oldDelegate) => true;
}
