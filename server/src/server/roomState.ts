import { ensureDir, pathExists, readdir, remove } from 'fs-extra';
import path from 'node:path';
import { SmelterInstance, type RegisterSmelterInputOptions, type SmelterOutput } from '../smelter';
import { hlsUrlForKickChannel, hlsUrlForTwitchChannel } from '../streamlink';
import { TwitchChannelMonitor } from '../twitch/TwitchChannelMonitor';
import { sleep } from '../utils';
import type { InputConfig, Layout } from '../app/store';
import mp4SuggestionsMonitor from '../mp4/mp4SuggestionMonitor';
import { KickChannelMonitor } from '../kick/KickChannelMonitor';
import type { ShaderConfig } from '../shaders/shaders';
import { WhipInputMonitor } from '../whip/WhipInputMonitor';

export type InputOrientation = 'horizontal' | 'vertical';

export type RoomInputState = {
  inputId: string;
  type: 'local-mp4' | 'twitch-channel' | 'kick-channel' | 'whip' | 'image' | 'text-input';
  status: 'disconnected' | 'pending' | 'connected';
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  metadata: {
    title: string;
    description: string;
  };
} & TypeSpecificState;

type TypeSpecificState =
  | { type: 'local-mp4'; mp4FilePath: string }
  | { type: 'twitch-channel'; channelId: string; hlsUrl: string; monitor: TwitchChannelMonitor }
  | { type: 'kick-channel'; channelId: string; hlsUrl: string; monitor: KickChannelMonitor }
  | { type: 'whip'; whipUrl: string; monitor: WhipInputMonitor }
  | { type: 'image'; imageId: string }
  | { type: 'text-input'; text: string; textAlign: 'left' | 'center' | 'right'; textColor: string; textMaxLines: number; textScrollSpeed: number; textScrollLoop: boolean; textScrollNudge: number; textFontSize: number };

type UpdateInputOptions = {
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  text: string;
  textAlign: 'left' | 'center' | 'right';
  textColor: string;
  textMaxLines: number;
  textScrollSpeed: number;
  textScrollLoop: boolean;
  textScrollNudge: number;
  textFontSize: number;
};

export type RegisterInputOptions =
  | {
      type: 'twitch-channel';
      channelId: string;
    }
  | {
      type: 'kick-channel';
      channelId: string;
    }
  | {
      type: 'whip';
      username: string;
    }
  | {
      type: 'local-mp4';
      source: {
        fileName?: string;
        url?: string;
      };
    }
  | {
      type: 'image';
      fileName?: string;
      imageId?: string;
    }
  | {
      type: 'text-input';
      text: string;
      textAlign?: 'left' | 'center' | 'right';
      textColor?: string;
      textMaxLines?: number;
      textScrollSpeed?: number;
      textScrollLoop?: boolean;
      textFontSize?: number;
    };

const PLACEHOLDER_LOGO_FILE = 'logo_Smelter.png';

export class RoomState {
  private inputs: RoomInputState[];
  private layout: Layout = 'picture-in-picture';
  public idPrefix: string;

  private mp4sDir: string;
  private mp4Files: string[];
  private output: SmelterOutput;

  private recording?: {
    outputId: string;
    filePath: string;
    fileName: string;
    startedAt: number;
    stoppedAt?: number;
  };

  public lastReadTimestamp: number;
  public creationTimestamp: number;

  public pendingDelete?: boolean;
  public isPublic: boolean = false;

  public constructor(idPrefix: string, output: SmelterOutput, initInputs: RegisterInputOptions[], skipDefaultInputs: boolean = false) {
    this.mp4sDir = path.join(process.cwd(), 'mp4s');
    this.mp4Files = mp4SuggestionsMonitor.mp4Files;
    this.inputs = [];
    this.idPrefix = idPrefix;
    this.output = output;

    this.lastReadTimestamp = Date.now();
    this.creationTimestamp = Date.now();

    void (async () => {
      await this.getInitialInputState(idPrefix, initInputs, skipDefaultInputs);
      const realThis = this;
      for (let i = 0; i < realThis.inputs.length; i++) {
        const maybeInput = realThis.inputs[i];
        if (maybeInput) {
          await this.connectInput(maybeInput.inputId);
        }
      }
    })();
  }

  private async getInitialInputState(
    idPrefix: string,
    initInputs: RegisterInputOptions[],
    skipDefaultInputs: boolean = false
  ): Promise<void> {
    if (initInputs.length > 0) {
      for (const input of initInputs) {
        await this.addNewInput(input);
      }
    } else if (!skipDefaultInputs) {
      // Filter out files starting with "logo_" or "wrapped_" for default auto-add
      const eligibleMp4Files = this.mp4Files.filter(file => !isBlockedDefaultMp4(file));

      if (eligibleMp4Files.length > 0) {
        const randomIndex = Math.floor(Math.random() * eligibleMp4Files.length);
        for (let i = 0; i < 2; i++) {
          const randomMp4 = eligibleMp4Files[(randomIndex + i) % eligibleMp4Files.length];
          const mp4FilePath = path.join(this.mp4sDir, randomMp4);

          this.inputs.push({
            inputId: `${idPrefix}::local::sample_streamer::${i}`,
            type: 'local-mp4',
            status: 'disconnected',
            showTitle: false,
            shaders: [],
            orientation: 'horizontal',
            metadata: {
              title: `[MP4] ${formatMp4Name(randomMp4)}`,
              description: '[Static source] AI Generated',
            },
            mp4FilePath,
            volume: 0,
          });
        }
      }
    }

    // Ensure placeholder is added if no inputs exist
    await this.ensurePlaceholder();
  }

  public getWhepUrl(): string {
    return this.output.url;
  }

  public getResolution(): { width: number; height: number } {
    return this.output.resolution;
  }

  public hasActiveRecording(): boolean {
    return !!this.recording && !this.recording.stoppedAt;
  }

  public async startRecording(): Promise<{ fileName: string }> {
    if (this.hasActiveRecording()) {
      throw new Error('Recording is already in progress for this room');
    }

    const recordingsDir = path.join(process.cwd(), 'recordings');
    await ensureDir(recordingsDir);

    const timestamp = Date.now();
    const recordingId = `${this.idPrefix}::recording::${timestamp}`;
    const safeRoomId = this.idPrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `recording-${safeRoomId}-${timestamp}.mp4`;
    const filePath = path.join(recordingsDir, fileName);

    await SmelterInstance.registerMp4Output(recordingId, this.output, filePath);

    this.recording = {
      outputId: recordingId,
      filePath,
      fileName,
      startedAt: timestamp,
    };

    return { fileName };
  }

  public async stopRecording(): Promise<{ fileName: string }> {
    if (!this.recording || this.recording.stoppedAt) {
      throw new Error('No active recording to stop for this room');
    }

    try {
      await SmelterInstance.unregisterOutput(this.recording.outputId);
    } finally {
      this.recording.stoppedAt = Date.now();
    }

    // Enforce a global cap on stored recordings to avoid unbounded growth.
    // Keep only the newest N recordings on disk and remove older ones.
    try {
      await pruneOldRecordings(10);
    } catch (err) {
      // Best-effort cleanup – log but don't fail the API if pruning fails.
      console.error('Failed to prune old recordings', err);
    }

    return { fileName: this.recording.fileName };
  }

  public getState(): [RoomInputState[], Layout] {
    this.lastReadTimestamp = Date.now();
    return [this.inputs, this.layout];
  }
  public getInputs(): RoomInputState[] {
    return this.inputs;
  }

  private getPlaceholderId(): string {
    return `${this.idPrefix}::placeholder::smelter-logo`;
  }

  private isPlaceholder(inputId: string): boolean {
    return inputId === this.getPlaceholderId();
  }

  private async ensurePlaceholder(): Promise<void> {
    // Check if there are any non-placeholder inputs
    const nonPlaceholderInputs = this.inputs.filter(inp => !this.isPlaceholder(inp.inputId));
    if (nonPlaceholderInputs.length > 0) {
      return; // Don't add placeholder if there are real inputs
    }

    // Check if placeholder already exists
    if (this.inputs.find(inp => this.isPlaceholder(inp.inputId))) {
      return; // Placeholder already exists
    }

    // Add placeholder
    const inputId = this.getPlaceholderId();
    const picturesDir = path.join(process.cwd(), 'pictures');
    const imagePath = path.join(picturesDir, PLACEHOLDER_LOGO_FILE);

    if (await pathExists(imagePath)) {
      const imageId = `placeholder::smelter-logo`;
      const assetType = 'png';

      // Register image resource
      try {
        await SmelterInstance.registerImage(imageId, {
          serverPath: imagePath,
          assetType: assetType as any,
        });
      } catch {
        // ignore if already registered
      }

      this.inputs.push({
        inputId,
        type: 'image',
        status: 'connected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        metadata: {
          title: 'Smelter',
          description: '',
        },
        volume: 0,
        imageId,
      });
      this.updateStoreWithState();
    }
  }

  private async removePlaceholder(): Promise<void> {
    const placeholder = this.inputs.find(inp => this.isPlaceholder(inp.inputId));
    if (placeholder) {
      this.inputs = this.inputs.filter(inp => !this.isPlaceholder(inp.inputId));
      this.updateStoreWithState();
    }
  }

  public async addNewWhipInput(username: string) {
    const inputId = `${this.idPrefix}::whip::${Date.now()}`;
    const monitor = await WhipInputMonitor.startMonitor(username);
    monitor.touch();
    this.inputs.push({
      inputId,
      type: 'whip',
      status: 'disconnected',
      showTitle: false,
      shaders: [],
      orientation: 'horizontal',
      monitor: monitor,
      metadata: {
        title: `[Camera] ${username}`,
        description: `Whip Input for ${username}`,
      },
      volume: 0,
      whipUrl: '',
    });

    return inputId;
  }

  public async addNewInput(opts: RegisterInputOptions) {
    // Remove placeholder if it exists
    await this.removePlaceholder();

    if (opts.type === 'whip') {
      const inputId = await this.addNewWhipInput(opts.username);
      return inputId;
    } else if (opts.type === 'twitch-channel') {
      const inputId = inputIdForTwitchInput(this.idPrefix, opts.channelId);
      if (this.inputs.find(input => input.inputId === inputId)) {
        throw new Error(`Input for Twitch channel ${opts.channelId} already exists.`);
      }

      const hlsUrl = await hlsUrlForTwitchChannel(opts.channelId);
      const monitor = await TwitchChannelMonitor.startMonitor(opts.channelId);

      const inputState: RoomInputState = {
        inputId,
        type: `twitch-channel`,
        status: 'disconnected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        metadata: {
          title: '', // will be populated on update
          description: '',
        },
        volume: 0,
        channelId: opts.channelId,
        hlsUrl,
        monitor,
      };
      monitor.onUpdate((streamInfo, _isLive) => {
        inputState.metadata.title = `[Twitch.tv/${streamInfo.category}] ${streamInfo.displayName}`;
        inputState.metadata.description = streamInfo.title;
        this.updateStoreWithState();
      });
      this.inputs.push(inputState);
      return inputId;
    } else if (opts.type === 'kick-channel') {
      const inputId = inputIdForKickInput(this.idPrefix, opts.channelId);
      if (this.inputs.find(input => input.inputId === inputId)) {
        throw new Error(`Input for Kick channel ${opts.channelId} already exists.`);
      }

      const hlsUrl = await hlsUrlForKickChannel(opts.channelId);
      const monitor = await KickChannelMonitor.startMonitor(opts.channelId);

      const inputState: RoomInputState = {
        inputId,
        type: `kick-channel`,
        status: 'disconnected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        metadata: {
          title: '', // will be populated on update
          description: '',
        },
        volume: 0,
        channelId: opts.channelId,
        hlsUrl,
        monitor,
      };

      monitor.onUpdate((streamInfo, _isLive) => {
        inputState.metadata.title = `[Kick.com] ${streamInfo.displayName}`;
        inputState.metadata.description = streamInfo.title;
        this.updateStoreWithState();
      });

      this.inputs.push(inputState);
      return inputId;
    } else if (opts.type === 'local-mp4' && opts.source.fileName) {
      console.log('Adding local mp4');
      let mp4Path = path.join(process.cwd(), 'mp4s', opts.source.fileName);
      let mp4Name = opts.source.fileName;
      const inputId = `${this.idPrefix}::local::sample_streamer::${Date.now()}`;

      if (await pathExists(mp4Path)) {
        this.inputs.push({
          inputId,
          type: 'local-mp4',
          status: 'disconnected',
          showTitle: false,
          shaders: [],
          orientation: 'horizontal',
          metadata: {
            title: `[MP4] ${formatMp4Name(mp4Name)}`,
            description: '[Static source] AI Generated',
          },
          mp4FilePath: mp4Path,
          volume: 0,
        });
      }

      return inputId;
    } else if (opts.type === 'image') {
      console.log('Adding image');
      const picturesDir = path.join(process.cwd(), 'pictures');
      const inputId = `${this.idPrefix}::image::${Date.now()}`;
      const exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];

      let fileName = opts.fileName;
      let imageId = opts.imageId;

      // If imageId is provided but not fileName, find the file
      if (imageId && !fileName) {
        const baseName = imageId.replace(/^pictures::/, '');
        const files = await readdir(picturesDir).catch(() => [] as string[]);
        const found = files.find(f => {
          const fBase = f.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
          return fBase === baseName;
        });
        if (found) {
          fileName = found;
        } else {
          throw new Error(`Image file not found for imageId: ${imageId}`);
        }
      }

      if (!fileName) {
        throw new Error('Either fileName or imageId must be provided for image input');
      }

      const imagePath = path.join(picturesDir, fileName);

      if (await pathExists(imagePath)) {
        const lower = fileName.toLowerCase();
        const ext = exts.find(x => lower.endsWith(x));
        if (!ext) {
          throw new Error(`Unsupported image format: ${fileName}`);
        }
        const baseName = fileName.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
        imageId = `pictures::${baseName}`;
        const assetType =
          ext === '.png' ? 'png' : ext === '.gif' ? 'gif' : ext === '.svg' ? 'svg' : 'jpeg';

        // Register image resource
        try {
          await SmelterInstance.registerImage(imageId, {
            serverPath: imagePath,
            assetType: assetType as any,
          });
        } catch {
          // ignore if already registered
        }

        this.inputs.push({
          inputId,
          type: 'image',
          status: 'connected',
          showTitle: false,
          shaders: [],
          orientation: 'horizontal',
          metadata: {
            title: formatImageName(fileName),
            description: '',
          },
          volume: 0,
          imageId,
        });
        this.updateStoreWithState();
      } else {
        throw new Error(`Image file not found: ${fileName}`);
      }

      return inputId;
    } else if (opts.type === 'text-input') {
      console.log('Adding text input');
      const inputId = `${this.idPrefix}::text::${Date.now()}`;

      this.inputs.push({
        inputId,
        type: 'text-input',
        status: 'connected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        metadata: {
          title: 'Text',
          description: '',
        },
        volume: 0,
        text: opts.text,
        textAlign: opts.textAlign ?? 'left',
        textColor: opts.textColor ?? '#ffffff',
        textMaxLines: opts.textMaxLines ?? 10,
        textScrollSpeed: opts.textScrollSpeed ?? 40,
        textScrollLoop: opts.textScrollLoop ?? true,
        textScrollNudge: 0,
        textFontSize: opts.textFontSize ?? 80,
      });
      this.updateStoreWithState();

      return inputId;
    }
  }

  public async removeInput(inputId: string): Promise<void> {
    const input = this.getInput(inputId);

    // Check if this is the last non-placeholder input
    const nonPlaceholderInputs = this.inputs.filter(inp => !this.isPlaceholder(inp.inputId));
    const willBeEmpty =
      nonPlaceholderInputs.length === 1 && nonPlaceholderInputs[0].inputId === inputId;

    // If removing the last input, add placeholder first
    if (willBeEmpty) {
      await this.ensurePlaceholder();
    }

    this.inputs = this.inputs.filter(input => input.inputId !== inputId);
    this.updateStoreWithState();
    if (input.type === 'twitch-channel' || input.type === 'kick-channel') {
      input.monitor.stop();
    }

    while (input.status === 'pending') {
      await sleep(500);
    }
    if (input.status === 'connected') {
      try {
        await SmelterInstance.unregisterInput(inputId);
      } catch (err: any) {
        console.log(err, 'Failed to unregister when removing input.');
      }
      input.status = 'disconnected';
    }
  }

  public async connectInput(inputId: string): Promise<string> {
    const input = this.getInput(inputId);
    if (input.status !== 'disconnected') {
      return '';
    }
    // Images are static resources, they don't need to be connected as stream inputs
    if (input.type === 'image') {
      input.status = 'connected';
      this.updateStoreWithState();
      return '';
    }
    input.status = 'pending';
    const options = registerOptionsFromInput(input);
    let response = '';
    try {
      const res = await SmelterInstance.registerInput(inputId, options);
      response = res;
    } catch (err: any) {
      response = err.body?.url;
      input.status = 'disconnected';
      throw err;
    }
    input.status = 'connected';
    this.updateStoreWithState();
    return response;
  }

  public async ackWhipInput(inputId: string): Promise<void> {
    const input = this.getInput(inputId);
    if (input.type !== 'whip') {
      throw new Error('Input is not a Whip input');
    }
    input.monitor.touch();
  }

  public async disconnectInput(inputId: string) {
    const input = this.getInput(inputId);
    if (input.status === 'disconnected') {
      return;
    }
    input.status = 'pending';
    this.updateStoreWithState();
    try {
      await SmelterInstance.unregisterInput(inputId);
    } finally {
      input.status = 'disconnected';
      this.updateStoreWithState();
    }
  }

  public async removeStaleWhipInputs(staleTtlMs: number): Promise<void> {
    const now = Date.now();
    for (const input of this.getInputs()) {
      if (input.type === 'whip') {
        const last = input.monitor.getLastAckTimestamp() || 0;
        if (now - last > staleTtlMs) {
          try {
            console.log('[monitor] Removing stale WHIP input', { inputId: input.inputId });
            await this.removeInput(input.inputId);
          } catch (err: any) {
            console.log(err, 'Failed to remove stale WHIP input');
          }
        }
      }
    }
  }

  public async updateInput(inputId: string, options: Partial<UpdateInputOptions>) {
    const input = this.getInput(inputId);
    input.volume = options.volume ?? input.volume;
    input.shaders = options.shaders ?? input.shaders;
    input.showTitle = options.showTitle ?? input.showTitle;
    input.orientation = options.orientation ?? input.orientation;
    if (input.type === 'text-input') {
      if (options.text !== undefined) {
        input.text = options.text;
      }
      if (options.textAlign !== undefined) {
        input.textAlign = options.textAlign;
      }
      if (options.textColor !== undefined) {
        input.textColor = options.textColor;
      }
      if (options.textMaxLines !== undefined) {
        input.textMaxLines = options.textMaxLines;
      }
      if (options.textScrollSpeed !== undefined) {
        input.textScrollSpeed = options.textScrollSpeed;
      }
      if (options.textScrollLoop !== undefined) {
        input.textScrollLoop = options.textScrollLoop;
      }
      if (options.textScrollNudge !== undefined) {
        input.textScrollNudge = options.textScrollNudge;
      }
      if (options.textFontSize !== undefined) {
        input.textFontSize = options.textFontSize;
      }
    }
    this.updateStoreWithState();
  }

  public reorderInputs(inputOrder: string[]) {
    const inputIdSet = new Set(this.inputs.map(input => input.inputId));
    const inputs: RoomInputState[] = [];
    for (const inputId of inputOrder) {
      const input = this.inputs.find(input => input.inputId === inputId);
      if (input) {
        inputs.push(input);
        inputIdSet.delete(inputId);
      }
    }
    for (const inputId of inputIdSet) {
      const input = this.inputs.find(input => input.inputId === inputId);
      if (input) {
        inputs.push(input);
      }
    }

    this.inputs = inputs;
    this.updateStoreWithState();
  }

  public async updateLayout(layout: Layout) {
    this.layout = layout;
    // When switching to wrapped layout, remove wrapped-static image inputs and add wrapped MP4s
    if (layout === 'wrapped') {
      await this.removeWrappedStaticInputs();
      void this.ensureWrappedMp4Inputs();
    }
    // When switching to wrapped-static layout, remove wrapped MP4 inputs and add wrapped images
    if (layout === 'wrapped-static') {
      await this.removeWrappedMp4Inputs();
      void this.ensureWrappedImageInputs();
    }
    this.updateStoreWithState();
  }

  public async deleteRoom() {
    const inputs = this.inputs;
    this.inputs = [];
    for (const input of inputs) {
      if (input.type === 'twitch-channel' || input.type === 'kick-channel') {
        input.monitor.stop();
      }
      try {
        await SmelterInstance.unregisterInput(input.inputId);
      } catch (err: any) {
        console.error('Failed to remove input when removing the room.', err?.body ?? err);
      }
    }

    try {
      await SmelterInstance.unregisterOutput(this.output.id);
    } catch (err: any) {
      console.error('Failed to remove output', err?.body ?? err);
    }

    if (this.recording && !this.recording.stoppedAt) {
      try {
        await SmelterInstance.unregisterOutput(this.recording.outputId);
      } catch (err: any) {
        console.error('Failed to remove recording output', err?.body ?? err);
      }
    }
  }

  private updateStoreWithState() {
    const inputs: InputConfig[] = this.inputs
      .filter(input => input.status === 'connected')
      .map(input => ({
        inputId: input.inputId,
        title: input.metadata.title,
        description: input.metadata.description,
        showTitle: input.showTitle,
        volume: input.volume,
        shaders: input.shaders,
        orientation: input.orientation,
        imageId: input.type === 'image' ? input.imageId : undefined,
        text: input.type === 'text-input' ? input.text : undefined,
        textAlign: input.type === 'text-input' ? input.textAlign : undefined,
        textColor: input.type === 'text-input' ? input.textColor : undefined,
        textMaxLines: input.type === 'text-input' ? input.textMaxLines : undefined,
        textScrollSpeed: input.type === 'text-input' ? input.textScrollSpeed : undefined,
        textScrollLoop: input.type === 'text-input' ? input.textScrollLoop : undefined,
        textScrollNudge: input.type === 'text-input' ? input.textScrollNudge : undefined,
        textFontSize: input.type === 'text-input' ? input.textFontSize : undefined,
      }));
    this.output.store.getState().updateState(inputs, this.layout);
  }

  private getInput(inputId: string): RoomInputState {
    const input = this.inputs.find(input => input.inputId === inputId);
    if (!input) {
      throw new Error(`Input ${inputId} not found`);
    }
    return input;
  }
  // Remove all wrapped-static image inputs
  private async removeWrappedStaticInputs(): Promise<void> {
    const inputsToRemove = this.inputs.filter(
      input => input.type === 'image' && input.imageId?.startsWith('wrapped::')
    );
    for (const input of inputsToRemove) {
      await this.removeInput(input.inputId);
    }
  }

  // Remove all wrapped MP4 inputs
  private async removeWrappedMp4Inputs(): Promise<void> {
    const inputsToRemove = this.inputs.filter(
      input => input.type === 'local-mp4' && input.inputId.includes('::local::wrapped::')
    );
    for (const input of inputsToRemove) {
      await this.removeInput(input.inputId);
    }
  }

  // Add every MP4 from wrapped/ as an input (if not present).
  private async ensureWrappedMp4Inputs(): Promise<void> {
    const wrappedDir = path.join(process.cwd(), 'wrapped');
    let entries: string[] = [];
    try {
      entries = await readdir(wrappedDir);
    } catch {
      return;
    }
    // Keep deterministic order
    entries.sort((a, b) => a.localeCompare(b, 'en'));
    const mp4s = entries.filter(e => e.toLowerCase().endsWith('.mp4'));

    // Remove placeholder if we're adding inputs
    if (mp4s.length > 0) {
      await this.removePlaceholder();
    }

    for (const fileName of mp4s) {
      const absPath = path.join(wrappedDir, fileName);
      const baseName = fileName.replace(/\.mp4$/i, '');
      const inputId = `${this.idPrefix}::local::wrapped::${baseName}`;
      if (this.inputs.find(inp => inp.inputId === inputId)) {
        continue;
      }
      this.inputs.push({
        inputId,
        type: 'local-mp4',
        status: 'disconnected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        metadata: {
          title: `[MP4] ${formatMp4Name(fileName)}`,
          description: '[Wrapped MP4]',
        },
        mp4FilePath: absPath,
        volume: 0,
      });
      // Connect the input
      void this.connectInput(inputId);
    }
  }

  // Add every image from wrapped/ as an input (if not present). Registers images on the fly.
  private async ensureWrappedImageInputs(): Promise<void> {
    const wrappedDir = path.join(process.cwd(), 'wrapped');
    let entries: string[] = [];
    try {
      entries = await readdir(wrappedDir);
    } catch {
      return;
    }
    // Keep deterministic order
    entries.sort((a, b) => a.localeCompare(b, 'en'));
    const exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg'];
    const images = entries.filter(e => exts.some(ext => e.toLowerCase().endsWith(ext)));

    // Remove placeholder if we're adding inputs
    if (images.length > 0) {
      await this.removePlaceholder();
    }

    for (const fileName of images) {
      const lower = fileName.toLowerCase();
      const ext = exts.find(x => lower.endsWith(x))!;
      const absPath = path.join(wrappedDir, fileName);
      const baseName = fileName.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
      const imageId = `wrapped::${baseName}`;
      const inputId = `${this.idPrefix}::image::${baseName}`;
      // register image resource
      const assetType =
        ext === '.png' ? 'png' : ext === '.gif' ? 'gif' : ext === '.svg' ? 'svg' : 'jpeg';
      try {
        await SmelterInstance.registerImage(imageId, {
          serverPath: absPath,
          assetType: assetType as any,
        });
      } catch {
        // ignore if already registered
      }
      if (this.inputs.find(inp => inp.inputId === inputId)) {
        continue;
      }
      this.inputs.push({
        inputId,
        type: 'image',
        status: 'connected',
        showTitle: false,
        shaders: [],
        orientation: 'horizontal',
        metadata: {
          title: formatImageName(fileName),
          description: '',
        },
        volume: 0,
        imageId,
      });
    }
  }
}

function registerOptionsFromInput(input: RoomInputState): RegisterSmelterInputOptions {
  if (input.type === 'local-mp4') {
    return { type: 'mp4', filePath: input.mp4FilePath };
  } else if (input.type === 'twitch-channel' || input.type === 'kick-channel') {
    return { type: 'hls', url: input.hlsUrl };
  } else if (input.type === 'whip') {
    return { type: 'whip', url: input.whipUrl };
  } else if (input.type === 'image') {
    // Images are static resources, they don't need to be registered as inputs
    // They are already registered via registerImage and used directly in layouts
    throw Error('Images cannot be connected as stream inputs');
  } else {
    throw Error('Unknown type');
  }
}

function inputIdForTwitchInput(idPrefix: string, twitchChannelId: string): string {
  return `${idPrefix}::twitch::${twitchChannelId}`;
}

function inputIdForKickInput(idPrefix: string, kickChannelId: string): string {
  return `${idPrefix}::kick::${kickChannelId}`;
}

function formatMp4Name(fileName: string): string {
  const fileNameWithoutExt = fileName.replace(/\.mp4$/i, '');
  return fileNameWithoutExt
    .split(/[_\- ]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatImageName(fileName: string): string {
  const fileNameWithoutExt = fileName.replace(/\.(jpg|jpeg|png|gif|svg)$/i, '');
  return fileNameWithoutExt
    .split(/[_\- ]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function isBlockedDefaultMp4(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.startsWith('logo_') || lower.startsWith('wrapped_');
}

/**
 * Keep at most `maxCount` newest MP4 recording files in the global
 * recordings directory by deleting the oldest ones.
 */
async function pruneOldRecordings(maxCount: number): Promise<void> {
  const recordingsDir = path.join(process.cwd(), 'recordings');
  if (!(await pathExists(recordingsDir))) {
    return;
  }

  let entries: string[] = [];
  try {
    entries = await readdir(recordingsDir);
  } catch {
    // If we can't read the directory, silently skip pruning.
    return;
  }

  const mp4s = entries.filter(e => e.toLowerCase().endsWith('.mp4'));
  if (mp4s.length <= maxCount) {
    return;
  }

  type RecordingFile = { name: string; timestamp: number };
  const parsed: RecordingFile[] = [];

  for (const file of mp4s) {
    // Expected pattern: recording-<safeRoomId>-<timestamp>.mp4
    const match = file.match(/^recording-.*-(\d+)\.mp4$/);
    const ts = match ? Number(match[1]) : NaN;
    if (!Number.isFinite(ts)) {
      // Fallback: treat unknown pattern as very old so it gets pruned first.
      parsed.push({ name: file, timestamp: 0 });
    } else {
      parsed.push({ name: file, timestamp: ts });
    }
  }

  parsed.sort((a, b) => a.timestamp - b.timestamp);

  const toDelete = parsed.slice(0, Math.max(0, parsed.length - maxCount));
  for (const file of toDelete) {
    const fullPath = path.join(recordingsDir, file.name);
    try {
      await remove(fullPath);
    } catch (err) {
      // Ignore individual deletion errors – best-effort cleanup.
      console.warn('Failed to remove old recording file', { file: fullPath, err });
    }
  }
}
