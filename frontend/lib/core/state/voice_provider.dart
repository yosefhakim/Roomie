import 'dart:async';
import 'package:agora_rtc_engine/agora_rtc_engine.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';
import '../network/socket_manager.dart';
import 'core_providers.dart';

class VoiceParticipantState {
  const VoiceParticipantState({required this.userId, this.isSpeaking = false, this.volume = 0});
  final String userId;
  final bool isSpeaking;
  final int volume; // 0-255, matches Agora's onAudioVolumeIndication scale
}

class VoiceState {
  const VoiceState({
    this.connected = false,
    this.canPublish = false,
    this.selfMuted = true,
    this.speakingUsers = const {},
  });

  final bool connected;
  final bool canPublish; // derived from the room role at token-issuance time - see voiceService.js on backend
  final bool selfMuted;
  final Map<String, VoiceParticipantState> speakingUsers;

  VoiceState copyWith({
    bool? connected,
    bool? canPublish,
    bool? selfMuted,
    Map<String, VoiceParticipantState>? speakingUsers,
  }) =>
      VoiceState(
        connected: connected ?? this.connected,
        canPublish: canPublish ?? this.canPublish,
        selfMuted: selfMuted ?? this.selfMuted,
        speakingUsers: speakingUsers ?? this.speakingUsers,
      );
}

/// Owns the Agora RTC engine lifecycle for one room's voice channel.
/// Integration flow matches exactly what's documented in
/// backend/README.md's "Client integration pattern (Flutter, Layer 7)"
/// section - written from the backend side during Layer 6, implemented
/// here in Layer 7.
class VoiceController extends StateNotifier<VoiceState> {
  VoiceController(this._ref) : super(const VoiceState()) {
    _voiceEventSubscription = _ref.read(socketManagerProvider).voiceEvents.listen(_handleSocketVoiceEvent);
  }

  final Ref _ref;
  RtcEngine? _engine;
  String? _currentRoomId;
  late final StreamSubscription<SocketEvent> _voiceEventSubscription;
  Timer? _vadThrottleTimer;

  Future<void> joinRoomVoice(String roomId) async {
    final micStatus = await Permission.microphone.request();
    if (!micStatus.isGranted) {
      throw Exception('Microphone permission denied - required to join voice chat');
    }

    // POST /api/voice/token - see backend/src/routes/voice.js. Returns
    // { appId, channelName, token, uid, canPublish, expiresAt }.
    final response = await _ref.read(apiClientProvider).dio.post('/api/voice/token', data: {'roomId': roomId});
    final tokenData = Map<String, dynamic>.from(response.data as Map);

    _engine ??= createAgoraRtcEngine();
    await _engine!.initialize(RtcEngineContext(appId: tokenData['appId'] as String));

    _engine!.registerEventHandler(RtcEngineEventHandler(
      onJoinChannelSuccess: (connection, elapsed) {
        state = state.copyWith(connected: true);
      },
      onLeaveChannel: (connection, stats) {
        state = state.copyWith(connected: false);
      },
      onAudioVolumeIndication: (connection, speakers, speakerNumber, totalVolume) {
        // This is the client-side VAD Agora provides out of the box - we
        // don't implement our own audio analysis. Each entry in `speakers`
        // has a uid and volume (0-255); we relay our OWN entry (uid 0
        // conventionally refers to the local user in Agora's callback, or
        // matching our issued uid) to the room via voice:activity so
        // everyone else's UI can render our speaking indicator. See
        // backend/src/sockets/voiceHandlers.js for the throttled relay
        // logic on the receiving end.
        for (final speaker in speakers) {
          if (speaker.uid == 0 || speaker.uid == tokenData['uid']) {
            _throttledEmitVoiceActivity(roomId, (speaker.volume ?? 0) > 5, speaker.volume ?? 0);
          }
        }
      },
      onError: (err, msg) {
        // Detailed Agora error-code handling is genuinely untestable
        // without live Agora credentials in this environment - see the
        // frontend README's honest-limitations section. In production,
        // surface this via a dedicated error stream/state field.
      },
    ));

    await _engine!.enableAudioVolumeIndication(interval: 200, smooth: 3, reportVad: true);

    final canPublish = tokenData['canPublish'] as bool;
    await _engine!.setClientRole(
      role: canPublish ? ClientRoleType.clientRoleBroadcaster : ClientRoleType.clientRoleAudience,
    );
    await _engine!.muteLocalAudioStream(!canPublish); // listeners join fully muted by construction

    await _engine!.joinChannel(
      token: tokenData['token'] as String,
      channelId: tokenData['channelName'] as String,
      uid: tokenData['uid'] as int,
      options: ChannelMediaOptions(
        clientRoleType: canPublish ? ClientRoleType.clientRoleBroadcaster : ClientRoleType.clientRoleAudience,
        channelProfile: ChannelProfileType.channelProfileCommunication,
      ),
    );

    _currentRoomId = roomId;
    state = state.copyWith(canPublish: canPublish, selfMuted: !canPublish);
  }

  Future<void> toggleSelfMute() async {
    if (_engine == null || _currentRoomId == null || !state.canPublish) return;
    final newMuted = !state.selfMuted;
    await _engine!.muteLocalAudioStream(newMuted);
    state = state.copyWith(selfMuted: newMuted);
    // Mirrors the mute state into the persistent room member record too
    // (see backend/src/sockets/voiceHandlers.js's voice:selfMuteToggle,
    // which wraps the same room:setMute path room_provider.dart's
    // setMute() uses) so the mic-muted icon is consistent for everyone,
    // not just an Agora-local state.
    _ref.read(socketManagerProvider).emit('voice:selfMuteToggle', {'roomId': _currentRoomId, 'muted': newMuted});
  }

  Future<void> leaveRoomVoice() async {
    await _engine?.leaveChannel();
    _currentRoomId = null;
    state = const VoiceState();
  }

  void _throttledEmitVoiceActivity(String roomId, bool isSpeaking, int volume) {
    // Client-side throttle in addition to the server-side one
    // (voiceHandlers.js already throttles to 150ms/room/user) - reduces
    // unnecessary socket traffic before it even leaves the device.
    if (_vadThrottleTimer?.isActive ?? false) return;
    _vadThrottleTimer = Timer(const Duration(milliseconds: 150), () {});
    _ref.read(socketManagerProvider).emit('voice:activity', {
      'roomId': roomId,
      'isSpeaking': isSpeaking,
      'volume': volume,
    });
  }

  void _handleSocketVoiceEvent(SocketEvent event) {
    switch (event.name) {
      case 'voice:activity':
        final data = Map<String, dynamic>.from(event.data as Map);
        final userId = data['userId'] as String;
        final updated = Map<String, VoiceParticipantState>.from(state.speakingUsers);
        updated[userId] = VoiceParticipantState(
          userId: userId,
          isSpeaking: data['isSpeaking'] as bool,
          volume: data['volume'] as int? ?? 0,
        );
        state = state.copyWith(speakingUsers: updated);
        break;
      case 'voice:roleChanged':
        // Per backend/src/sockets/roomHandlers.js's room:setRole handler
        // and the design note in the Layer 6 README: an Agora token bakes
        // in publish/subscribe capability at issuance and can't be
        // upgraded in place, so a role change means we must fetch a fresh
        // token and rejoin.
        if (_currentRoomId != null) {
          final roomId = _currentRoomId!;
          leaveRoomVoice().then((_) => joinRoomVoice(roomId));
        }
        break;
    }
  }

  @override
  void dispose() {
    _voiceEventSubscription.cancel();
    _vadThrottleTimer?.cancel();
    _engine?.leaveChannel();
    _engine?.release();
    super.dispose();
  }
}

final voiceControllerProvider = StateNotifierProvider<VoiceController, VoiceState>((ref) => VoiceController(ref));
