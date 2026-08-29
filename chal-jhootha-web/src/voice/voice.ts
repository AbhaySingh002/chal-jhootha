const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

type VoiceSignal = {
  fromUserId: string;
  targetUserId?: string;
  kind: string;
  payload?: any;
};

export class RoomVoice {
  private stream: MediaStream | null = null;
  private muted = true;
  private peers = new Map<string, RTCPeerConnection>();
  private send: (kind: string, payload?: unknown, target?: string) => void;
  private selfId: string;

  constructor(selfId: string, send: (kind: string, payload?: unknown, target?: string) => void) {
    this.selfId = selfId;
    this.send = send;
    window.addEventListener('cj-voice', this.onSignal as EventListener);
  }

  async join() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.stream.getAudioTracks().forEach((t) => { t.enabled = !this.muted; });
    this.send('join');
  }

  leave() {
    this.send('leave');
    this.peers.forEach((pc) => pc.close());
    this.peers.clear();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    window.removeEventListener('cj-voice', this.onSignal as EventListener);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.stream?.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    this.send('mute', { muted });
  }

  private onSignal = (ev: Event) => {
    const signal = (ev as CustomEvent<VoiceSignal>).detail;
    if (!signal || signal.fromUserId === this.selfId) return;
    void this.handle(signal);
  };

  private async handle(signal: VoiceSignal) {
    if (signal.kind === 'join') {
      await this.offerTo(signal.fromUserId);
      return;
    }
    if (signal.kind === 'leave') {
      this.peers.get(signal.fromUserId)?.close();
      this.peers.delete(signal.fromUserId);
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

  private async offerTo(peerId: string) {
    const pc = this.ensurePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send('offer', offer, peerId);
  }

  private ensurePeer(peerId: string) {
    let pc = this.peers.get(peerId);
    if (pc) return pc;
    pc = new RTCPeerConnection(STUN);
    this.stream?.getTracks().forEach((t) => pc!.addTrack(t, this.stream!));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send('ice', e.candidate, peerId);
    };
    pc.ontrack = (e) => {
      let el = document.getElementById(`voice-${peerId}`) as HTMLAudioElement | null;
      if (!el) {
        el = document.createElement('audio');
        el.id = `voice-${peerId}`;
        el.autoplay = true;
        document.body.appendChild(el);
      }
      el.srcObject = e.streams[0];
    };
    this.peers.set(peerId, pc);
    return pc;
  }
}
