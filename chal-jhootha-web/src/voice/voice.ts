import { fetchVoiceIceServers, type IceServer } from '../lib/auth';

const STUN: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

type VoiceSignal = {
  fromUserId: string;
  targetUserId?: string;
  kind: string;
  payload?: any;
};

export class RoomVoice {
  private stream: MediaStream | null = null;
  private muted = true;
  private speakerMuted = false;
  private peers = new Map<string, RTCPeerConnection>();
  private remoteAudio = new Map<string, HTMLAudioElement>();
  private send: (kind: string, payload?: unknown, target?: string) => void;
  private selfId: string;
  private rtcConfig: RTCConfiguration = STUN;

  constructor(selfId: string, send: (kind: string, payload?: unknown, target?: string) => void) {
    this.selfId = selfId;
    this.send = send;
    window.addEventListener('cj-voice', this.onSignal as EventListener);
  }

  async join() {
    if (this.stream) return;
    try {
      this.rtcConfig = { iceServers: await fetchVoiceIceServers() as IceServer[] };
    } catch {
      this.rtcConfig = STUN;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.stream.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    this.send('join');
  }

  leave() {
    if (this.stream) this.send('leave');
    this.peers.forEach((pc) => pc.close());
    this.peers.clear();
    this.remoteAudio.forEach((audio) => audio.remove());
    this.remoteAudio.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  dispose() {
    this.leave();
    window.removeEventListener('cj-voice', this.onSignal as EventListener);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    this.send('mute', { muted });
  }

  setSpeakerMuted(muted: boolean) {
    this.speakerMuted = muted;
    this.remoteAudio.forEach((audio) => {
      audio.muted = muted;
    });
  }

  private onSignal = (ev: Event) => {
    const signal = (ev as CustomEvent<VoiceSignal>).detail;
    if (!signal || signal.fromUserId === this.selfId) return;
    void this.handle(signal).catch(() => undefined);
  };

  private async handle(signal: VoiceSignal) {
    if (signal.kind === 'join') {
      await this.offerTo(signal.fromUserId);
      return;
    }
    if (signal.kind === 'leave') {
      this.peers.get(signal.fromUserId)?.close();
      this.peers.delete(signal.fromUserId);
      this.removeRemoteAudio(signal.fromUserId);
      return;
    }
    if (signal.kind === 'offer') {
      const pc = this.ensurePeer(signal.fromUserId);
      await pc.setRemoteDescription(signal.payload);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send('answer', answer, signal.fromUserId);
      return;
    }
    if (signal.kind === 'answer') {
      const pc = this.peers.get(signal.fromUserId);
      if (pc) await pc.setRemoteDescription(signal.payload);
      return;
    }
    if (signal.kind === 'ice') {
      const pc = this.ensurePeer(signal.fromUserId);
      if (signal.payload) await pc.addIceCandidate(signal.payload);
    }
  }

  private async offerTo(peerId: string, iceRestart = false) {
    const pc = this.ensurePeer(peerId);
    const offer = await pc.createOffer({ iceRestart });
    await pc.setLocalDescription(offer);
    this.send('offer', offer, peerId);
  }

  private ensurePeer(peerId: string) {
    let pc = this.peers.get(peerId);
    if (pc) return pc;
    pc = new RTCPeerConnection(this.rtcConfig);
    this.stream?.getTracks().forEach((t) => pc!.addTrack(t, this.stream!));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send('ice', e.candidate, peerId);
    };
    pc.ontrack = (e) => {
      let el = this.remoteAudio.get(peerId);
      if (!el) {
        el = document.createElement('audio');
        el.id = `chal-jhootha-voice-${peerId}`;
        el.autoplay = true;
        document.body.appendChild(el);
        this.remoteAudio.set(peerId, el);
      }
      el.muted = this.speakerMuted;
      el.srcObject = e.streams[0];
      void el.play().catch(() => undefined);
    };
    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'failed' && this.stream) {
        void this.offerTo(peerId, true).catch(() => undefined);
      }
    };
    this.peers.set(peerId, pc);
    return pc;
  }

  private removeRemoteAudio(peerId: string) {
    const audio = this.remoteAudio.get(peerId);
    audio?.remove();
    this.remoteAudio.delete(peerId);
  }
}
