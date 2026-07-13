"use client";
import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClapperboardIcon, ImageIcon } from 'lucide-react';
import type { VideoExportRequest, VideoExportProgress, VideoSizeMode } from './ExportDialog';

// The export dialog for App Preview VIDEO projects. Deliberately separate from
// the screenshot ExportDialog: a video board has no business offering to
// generate 1290×2796 App Store *screenshot* sizes. Video is the whole point
// here; PNG is demoted to a single still (useful as the App Store poster
// frame, which Apple picks from the video anyway).

interface AppPreviewExportDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  videoBoardCount: number;
  suggestedVideoDuration: number;
  onExportVideo: (request: VideoExportRequest) => void;
  onCancelVideoExport: () => void;
  onExportStills: () => void;
  videoProgress: VideoExportProgress | null;
  isVideoExporting: boolean;
}

export function AppPreviewExportDialog({
  isOpen,
  onOpenChange,
  videoBoardCount,
  suggestedVideoDuration,
  onExportVideo,
  onCancelVideoExport,
  onExportStills,
  videoProgress,
  isVideoExporting,
}: AppPreviewExportDialogProps) {
  const [fps, setFps] = useState<'30' | '60'>('30');
  const [duration, setDuration] = useState<number>(15);
  const [sizeMode, setSizeMode] = useState<VideoSizeMode>('appstore-portrait');
  const [rawRecordingOnly, setRawRecordingOnly] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRawRecordingOnly(false);
      setDuration(suggestedVideoDuration);
    }
  }, [isOpen, suggestedVideoDuration]);

  const durationWarning =
    duration < 15
      ? 'Apple requires 15 to 30 seconds. Shorter is fine for ads and socials, but App Store Connect will reject it.'
      : null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClapperboardIcon className="w-5 h-5" />
            Export App Preview Video
          </DialogTitle>
          <DialogDescription>
            {videoBoardCount === 0
              ? 'Add a recording mockup (Elements > App Preview) and drop your screen recording into it.'
              : videoBoardCount === 1
                ? 'This artboard renders to one MP4.'
                : `Each of the ${videoBoardCount} artboards renders to its own MP4. Apple accepts up to 3 previews per device size.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <RadioGroup
            className="grid gap-2"
            value={rawRecordingOnly ? 'raw' : 'styled'}
            onValueChange={(v) => setRawRecordingOnly(v === 'raw')}
          >
            <div className="flex items-start space-x-2">
              <RadioGroupItem id="apv-styled" value="styled" className="mt-0.5" />
              <div className="grid gap-0.5 leading-none">
                <Label htmlFor="apv-styled">Styled video</Label>
                <p className="text-xs text-muted-foreground">
                  The whole artboard: headlines, phone mockup, gesture hints and
                  animations, with your recording playing inside the screen. For
                  ads, socials and your website.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-2">
              <RadioGroupItem id="apv-raw" value="raw" className="mt-0.5" />
              <div className="grid gap-0.5 leading-none">
                <Label htmlFor="apv-raw">Store-ready recording (no design)</Label>
                <p className="text-xs text-muted-foreground">
                  Your recording alone, resized and re-encoded to the exact size
                  Apple accepts, with your trim applied. A phone records at
                  1290×2796, which App Store Connect rejects, so upload this file
                  instead. Apple does not allow device frames or added text in a
                  store preview, which is why the design is left out here.
                </p>
              </div>
            </div>
          </RadioGroup>

          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="apv-size" className="text-xs">Size</Label>
              <Select value={sizeMode} onValueChange={(v) => setSizeMode(v as VideoSizeMode)}>
                <SelectTrigger id="apv-size" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="appstore-portrait">iPhone 886×1920</SelectItem>
                  <SelectItem value="appstore-landscape">iPhone 1920×886</SelectItem>
                  <SelectItem value="artboard">Artboard size</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="apv-fps" className="text-xs">Frame rate</Label>
              <Select value={fps} onValueChange={(v) => setFps(v as '30' | '60')}>
                <SelectTrigger id="apv-fps" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 fps</SelectItem>
                  <SelectItem value="60">60 fps</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="apv-duration" className="text-xs">Duration (s)</Label>
              <Input
                id="apv-duration"
                type="number"
                min={1}
                max={30}
                className="h-8 text-xs"
                value={duration}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isNaN(v)) setDuration(Math.max(1, Math.min(30, v)));
                }}
              />
            </div>
          </div>
          {durationWarning && (
            <p className="text-xs text-amber-600 dark:text-amber-500 -mt-2">{durationWarning}</p>
          )}

          {isVideoExporting && videoProgress ? (
            <div className="grid gap-2">
              <p className="text-xs text-muted-foreground">
                Rendering {videoProgress.boardName} ({videoProgress.boardIndex}/{videoProgress.boardCount}),
                frame {videoProgress.frame} of {videoProgress.totalFrames}...
              </p>
              <Progress value={(videoProgress.frame / Math.max(1, videoProgress.totalFrames)) * 100} />
              <Button variant="outline" size="sm" className="justify-self-start" onClick={onCancelVideoExport}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              disabled={isVideoExporting || videoBoardCount === 0}
              onClick={() =>
                onExportVideo({
                  fps: parseInt(fps, 10),
                  durationSeconds: duration,
                  sizeMode,
                  rawRecordingOnly,
                })
              }
            >
              <ClapperboardIcon className="w-4 h-4 mr-1.5" />
              {rawRecordingOnly ? 'Export Store-Ready Recording' : 'Export Styled Video'}
            </Button>
          )}

          <div className="border-t pt-3">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8 px-2"
              disabled={isVideoExporting}
              onClick={onExportStills}
            >
              <ImageIcon className="w-3.5 h-3.5 mr-1.5" />
              Export PNG stills instead
            </Button>
            <p className="text-[11px] text-muted-foreground mt-1">
              One PNG per artboard at the canvas size. Handy for a poster frame
              or a social still.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
