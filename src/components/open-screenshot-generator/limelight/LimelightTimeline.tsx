"use client";

// The Limelight timeline: the clock and play controls, a ruler, the camera's
// shots, and a track for each thing on the stage with its poses and the
// pictures its screen changes to. Click or drag anywhere on the tracks to
// move the playhead; drag a key to move it in time (it snaps to frames).
// Only the playhead and the clock follow playback, so the tracks never draw
// again while the video plays.

import React, { useRef } from 'react';
import { MonitorSmartphoneIcon, PauseIcon, PlayIcon, RepeatIcon, TypeIcon, VideoIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { updatePose, updateShot, setScreens } from '@/lib/limelight/edit';
import type { LimelightScene } from '@/lib/limelight/types';
import { cn } from '@/lib/utils';
import { formatClock } from './controls';
import { useTime, type TimeStore } from './time';

export type LimelightSelection =
  | { kind: 'scene' }
  | { kind: 'shot'; id: string }
  | { kind: 'actor'; id: string }
  | { kind: 'pose'; actorId: string; id: string }
  | { kind: 'screen'; actorId: string; id: string };

const LABEL_WIDTH = 132;
const ROW_HEIGHT = 30;

interface TimelineProps {
  scene: LimelightScene;
  time: TimeStore;
  playing: boolean;
  loop: boolean;
  selection: LimelightSelection;
  onPlay: () => void;
  onLoop: () => void;
  onSeek: (time: number) => void;
  onSelect: (selection: LimelightSelection) => void;
  onCommit: (next: LimelightScene, merge?: string) => void;
  onDragEnd: () => void;
}

function Clock({ time, duration }: { time: TimeStore; duration: number }) {
  const now = useTime(time);
  return (
    <span className="tabular-nums text-xs text-muted-foreground" data-testid="limelight-clock">
      <span className="font-medium text-foreground">{formatClock(now)}</span> / {formatClock(duration)}
    </span>
  );
}

function Playhead({ time, duration, width }: { time: TimeStore; duration: number; width: number }) {
  const now = useTime(time);
  const x = duration > 0 ? (Math.min(now, duration) / duration) * width : 0;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary" style={{ transform: `translateX(${x}px)` }} data-testid="limelight-playhead">
      <div className="absolute -left-[5px] -top-0.5 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-primary" />
    </div>
  );
}

function tickStep(duration: number, width: number): number {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30];
  return steps.find((step) => (step / duration) * width >= 46) ?? 30;
}

export function LimelightTimeline({ scene, time, playing, loop, selection, onPlay, onLoop, onSeek, onSelect, onCommit, onDragEnd }: TimelineProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(600);
  const duration = scene.format.duration;
  const fps = scene.format.fps;
  const drag = useRef<null | { kind: 'scrub' } | { kind: 'key'; apply: (t: number) => LimelightScene; merge: string; moved: boolean }>(null);

  React.useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const measure = () => setWidth(Math.max(100, area.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  const timeAt = (clientX: number) => {
    const rect = areaRef.current!.getBoundingClientRect();
    const t = ((clientX - rect.left) / rect.width) * duration;
    // On a frame, so a key lands where a video frame is drawn.
    return Math.min(duration, Math.max(0, Math.round(t * fps) / fps));
  };
  const xOf = (t: number) => (Math.min(t, duration) / duration) * width;

  const startScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind: 'scrub' };
    onSeek(timeAt(event.clientX));
  };

  const startKey = (event: React.PointerEvent, select: LimelightSelection, keyTime: number, apply: (t: number) => LimelightScene, merge: string) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    areaRef.current?.setPointerCapture(event.pointerId);
    onSelect(select);
    onSeek(keyTime);
    drag.current = { kind: 'key', apply, merge, moved: false };
  };

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const t = timeAt(event.clientX);
    if (current.kind === 'scrub') {
      onSeek(t);
      return;
    }
    current.moved = true;
    onCommit(current.apply(t), current.merge);
    onSeek(t);
  };

  const onUp = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.kind === 'key' && current.moved) onDragEnd();
  };

  const step = tickStep(duration, width);
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(Math.round(t * 1000) / 1000);

  const isSelected = (kind: LimelightSelection['kind'], id: string) => selection.kind === kind && 'id' in selection && selection.id === id;

  return (
    <div className="shrink-0 border-t bg-background" data-testid="limelight-timeline">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
          {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
        </Button>
        <Clock time={time} duration={duration} />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn('h-7 w-7', loop ? 'text-primary' : 'text-muted-foreground')}
          onClick={onLoop}
          aria-label="Repeat"
          aria-pressed={loop}
          title={loop ? 'Plays again from the start when it ends' : 'Stops at the end'}
        >
          <RepeatIcon className="h-3.5 w-3.5" />
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">Move the playhead, then drag the stage to add a shot there</span>
      </div>
      <div className="relative select-none pb-2">
        <div className="flex">
          <div style={{ width: LABEL_WIDTH }} className="shrink-0" />
          <div
            ref={areaRef}
            className="relative mr-3 min-w-0 flex-1 cursor-text touch-none"
            onPointerDown={startScrub}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            data-testid="limelight-tracks"
          >
            {/* The ruler */}
            <div className="relative h-5 border-b text-[10px] text-muted-foreground">
              {ticks.map((t) => (
                <div key={t} className="absolute bottom-0 h-2 border-l border-border" style={{ left: xOf(t) }}>
                  <span className="absolute -top-3.5 left-1 whitespace-nowrap tabular-nums">{t % 1 === 0 ? `${t}s` : ''}</span>
                </div>
              ))}
            </div>
            {/* The rows, drawn under the labels' column through negative margin. */}
            <div className="relative" style={{ height: ROW_HEIGHT * (1 + scene.actors.length) }}>
              <div className="absolute inset-x-0 border-b" style={{ top: 0, height: ROW_HEIGHT }} />
              {scene.camera.shots.map((shot, index) => (
                <button
                  key={shot.id}
                  type="button"
                  className={cn(
                    'absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[3px] border-2 transition-colors',
                    isSelected('shot', shot.id) ? 'border-primary bg-primary' : 'border-primary bg-background hover:bg-primary/40'
                  )}
                  style={{ left: xOf(shot.time), top: ROW_HEIGHT / 2 }}
                  aria-label={`Shot ${index + 1} at ${shot.time.toFixed(1)} seconds`}
                  title={`Shot ${index + 1}, ${shot.time.toFixed(1)} s`}
                  data-testid="limelight-shot"
                  onPointerDown={(event) =>
                    startKey(event, { kind: 'shot', id: shot.id }, shot.time, (t) => updateShot(scene, shot.id, { time: t }), `retime:${shot.id}`)
                  }
                />
              ))}
              {scene.actors.map((actor, row) => {
                const top = ROW_HEIGHT * (row + 1);
                return (
                  <div key={actor.id} className="absolute inset-x-0 border-b" style={{ top, height: ROW_HEIGHT }}>
                    {actor.kind === 'device' &&
                      actor.screens.map((screen, index) => (
                        <button
                          key={screen.id}
                          type="button"
                          className={cn(
                            'absolute top-1/2 h-5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-[3px] border',
                            isSelected('screen', screen.id) ? 'border-primary bg-primary/30' : 'border-muted-foreground/50 bg-muted hover:border-primary'
                          )}
                          style={{ left: xOf(screen.time) + 9 }}
                          aria-label={`Picture ${index + 1} on ${actor.name} at ${screen.time.toFixed(1)} seconds`}
                          title={`Picture ${index + 1}, from ${screen.time.toFixed(1)} s`}
                          onPointerDown={(event) =>
                            startKey(
                              event,
                              { kind: 'screen', actorId: actor.id, id: screen.id },
                              screen.time,
                              (t) => setScreens(scene, actor.id, actor.screens.map((s) => (s.id === screen.id ? { ...s, time: t } : s))),
                              `retime:${screen.id}`
                            )
                          }
                        />
                      ))}
                    {actor.poses.map((pose, index) => (
                      <button
                        key={pose.id}
                        type="button"
                        className={cn(
                          'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
                          isSelected('pose', pose.id) ? 'border-sky-500 bg-sky-500' : 'border-sky-500 bg-background hover:bg-sky-500/40'
                        )}
                        style={{ left: xOf(pose.time) }}
                        aria-label={`Pose ${index + 1} of ${actor.name} at ${pose.time.toFixed(1)} seconds`}
                        title={`Pose ${index + 1}, ${pose.time.toFixed(1)} s`}
                        onPointerDown={(event) =>
                          startKey(
                            event,
                            { kind: 'pose', actorId: actor.id, id: pose.id },
                            pose.time,
                            (t) => updatePose(scene, actor.id, pose.id, { time: t }),
                            `retime:${pose.id}`
                          )
                        }
                      />
                    ))}
                  </div>
                );
              })}
            </div>
            <Playhead time={time} duration={duration} width={width} />
          </div>
        </div>
        {/* Track names, over the empty column on the left. */}
        <div className="pointer-events-none absolute left-0 top-5" style={{ width: LABEL_WIDTH }}>
          <div className="pointer-events-auto">
            <button
              type="button"
              className={cn('flex w-full items-center gap-2 truncate px-3 text-left text-xs', selection.kind === 'scene' ? 'font-semibold' : 'text-muted-foreground hover:text-foreground')}
              style={{ height: ROW_HEIGHT }}
              onClick={() => onSelect({ kind: 'scene' })}
              title="The camera's shots, and the look of the whole scene"
            >
              <VideoIcon className="h-3.5 w-3.5 shrink-0" />
              Camera
            </button>
            {scene.actors.map((actor) => (
              <button
                key={actor.id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-3 text-left text-xs',
                  (selection.kind === 'actor' || selection.kind === 'pose' || selection.kind === 'screen') && ('actorId' in selection ? selection.actorId : selection.id) === actor.id
                    ? 'font-semibold'
                    : 'text-muted-foreground hover:text-foreground',
                  actor.hidden && 'line-through opacity-60'
                )}
                style={{ height: ROW_HEIGHT }}
                onClick={() => onSelect({ kind: 'actor', id: actor.id })}
              >
                {actor.kind === 'device' ? <MonitorSmartphoneIcon className="h-3.5 w-3.5 shrink-0" /> : <TypeIcon className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{actor.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
