import { convertArgs, hasAlpha, type MediaInfo } from './plan';
export interface ProxyComputer {
  logicalCores: number;
  softwareVideo: boolean;
}
export interface ProxyPlan {
  width: number;
  height: number;
  target: 'mp4' | 'webm-alpha';
}

/** Automatic only when this computer is known slow, and only above a 1080p landscape/portrait bound. */
export function proxyPlan(info: MediaInfo, computer: ProxyComputer): ProxyPlan | null {
  const slow = computer.softwareVideo || (computer.logicalCores > 0 && computer.logicalCores <= 2);
  const video = info.video;
  if (!slow || !video || video.still || video.width < 2 || video.height < 2) return null;
  if (Math.max(video.width, video.height) <= 1920 && Math.min(video.width, video.height) <= 1080) return null;
  const landscape = video.width >= video.height;
  const scale = Math.min(
    1,
    (landscape ? 1920 : 1080) / video.width,
    (landscape ? 1080 : 1920) / video.height,
  );
  return {
    width: Math.max(2, Math.floor((video.width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((video.height * scale) / 2) * 2),
    target: hasAlpha(info) ? 'webm-alpha' : 'mp4',
  };
}

export function proxyArgs(source: string, dest: string, info: MediaInfo, computer: ProxyComputer): string[] {
  const plan = proxyPlan(info, computer);
  if (!plan) throw new Error('This video does not need a smaller playing copy.');
  const args = convertArgs(plan.target, source, dest, { ...info, container: null });
  const input = args.indexOf('-i');
  const decoder =
    plan.target === 'webm-alpha' && info.video?.codec === 'vp9'
      ? ['-c:V:0', 'libvpx-vp9']
      : plan.target === 'webm-alpha' && info.video?.codec === 'vp8'
        ? ['-c:V:0', 'libvpx']
        : [];
  args.splice(input, 0, '-nostdin', '-threads', '1', '-filter_threads', '1', ...decoder);
  args[args.indexOf('0:v:0')] = '0:V:0';
  const filter = args.indexOf('-vf') + 1;
  const normalize = "scale=w='trunc(iw*if(gt(sar,0),sar,1)/2)*2':h=trunc(ih/2)*2,setsar=1";
  const bound =
    "scale=w='if(gte(iw,ih),min(iw,1920),min(iw,1080))':h='if(gte(iw,ih),min(ih,1080),min(ih,1920))':force_original_aspect_ratio=decrease:force_divisible_by=2";
  args[filter] =
    `${info.video?.interlaced ? 'bwdif=mode=send_frame:deint=interlaced,' : ''}${normalize},${bound},format=${plan.target === 'webm-alpha' ? 'yuva420p' : 'yuv420p'}`;
  args.splice(
    args.length - 1,
    0,
    '-threads',
    '1',
    '-metadata:s:v:0',
    'rotate=0',
    '-f',
    plan.target === 'webm-alpha' ? 'webm' : 'mp4',
  );
  return args;
}
