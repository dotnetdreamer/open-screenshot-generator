import React from "react";
import { Img, staticFile } from "remotion";
import { V } from "./style";
import {
  CountChips,
  Gold,
  Head,
  Inset,
  Kicker,
  PromptCard,
  Shot,
  Split,
  Sub,
  Teal,
  Terminal,
  Underline,
} from "./ui";

type Beat = { local: number; len: number };

/** The copy block every beat in this act shares. */
const Copy: React.FC<{
  local: number;
  kicker: string;
  head: React.ReactNode;
  sub: React.ReactNode;
  extra?: React.ReactNode;
  accent?: string;
}> = ({ local, kicker, head, sub, extra, accent = V.teal }) => (
  <>
    <Kicker local={local} delay={0} color={accent}>
      {kicker}
    </Kicker>
    <div style={{ marginTop: 22 }}>
      <Head local={local} delay={6} size={72}>
        {head}
      </Head>
    </div>
    <div style={{ marginTop: 20 }}>
      <Underline local={local} delay={22} width={190} />
    </div>
    <div style={{ marginTop: 22 }}>
      <Sub local={local} delay={18} size={29}>
        {sub}
      </Sub>
    </div>
    {extra ? <div style={{ marginTop: 24 }}>{extra}</div> : null}
  </>
);

/** 101 templates, and the five surfaces they cover. */
export const Templates: React.FC<Beat> = ({ local }) => (
  <Split
    copy={
      <Copy
        local={local}
        kicker="Start"
        head={
          <>
            <Gold>101 templates</Gold> ready to open
          </>
        }
        sub="App Store and Play screenshots, Apple Watch, Mac, and Google Play feature graphics, all editable down to the last layer"
      />
    }
    visual={
      <div style={{ display: "flex", flexDirection: "column", gap: 22, width: 1010 }}>
        <Shot src="ui-templates" width={1010} local={local} delay={10} from="right" />
        <CountChips
          local={local}
          delay={30}
          items={[
            { n: 62, label: "screenshots" },
            { n: 6, label: "Apple Watch" },
            { n: 12, label: "Mac" },
            { n: 6, label: "preview videos" },
            { n: 15, label: "feature graphics" },
          ]}
        />
      </div>
    }
  />
);

/** One canvas, every artboard, every frame. */
export const Canvas: React.FC<Beat> = ({ local }) => (
  <Split
    side="left"
    copy={
      <Copy
        local={local}
        kicker="Design"
        head={
          <>
            Every artboard on <Teal>one canvas</Teal>
          </>
        }
        sub="iPhone, iPad, Android, Apple Watch, Mac and desktop frames, tilted in 3D or flat, or a mockup image of your own"
      />
    }
    visual={
      <div style={{ position: "relative" }}>
        <Shot src="ui-canvas" width={990} local={local} delay={10} from="left" />
        <Inset local={local} delay={36} style={{ left: 26, bottom: -58, width: 176 }}>
          <Img
            src={staticFile("features/ui-devices.png")}
            style={{ display: "block", width: "100%" }}
          />
        </Inset>
      </div>
    }
  />
);

/** The export that knows what the stores want. */
export const Export: React.FC<Beat> = ({ local }) => (
  <Split
    copy={
      <Copy
        local={local}
        kicker="Ship"
        head={
          <>
            Every store size in <Gold>one pass</Gold>
          </>
        }
        sub="Pick the devices you are filing for and it renders each artboard at the exact dimensions, in the fonts you chose, at a third of the file size it used to write"
      />
    }
    visual={
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 34 }}>
        <Shot src="ui-export" width={560} local={local} delay={10} from="right" />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {["cinevault-stream", "coinly-crypto", "droply-habits"].map((name, i) => (
            <div
              key={name}
              style={{
                width: 270,
                borderRadius: 10,
                overflow: "hidden",
                border: `1px solid ${V.strokeSoft}`,
                boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
                opacity: Math.min(1, Math.max(0, (local - (44 + i * 12)) / 18)),
                transform: `translateX(${Math.max(0, 40 - (local - (44 + i * 12)) * 2.4)}px)`,
              }}
            >
              <Img
                src={staticFile(`vs/wall/${name}.png`)}
                style={{ display: "block", width: "100%" }}
              />
            </div>
          ))}
        </div>
      </div>
    }
  />
);

/** App preview videos, on the same canvas as the screenshots. */
export const Video: React.FC<Beat> = ({ local }) => (
  <Split
    side="left"
    copy={
      <Copy
        local={local}
        kicker="Motion"
        head={
          <>
            App preview videos, <Teal>same canvas</Teal>
          </>
        }
        sub="Drop a screen recording into the phone, animate the headlines on a timeline, then export the MP4 the App Store accepts"
      />
    }
    visual={
      <div style={{ position: "relative", width: 860 }}>
        <Shot src="ui-video-boards" width={470} local={local} delay={10} from="left" />
        <div style={{ position: "absolute", left: 130, top: 276, width: 760 }}>
          <Shot src="ui-timeline" width={760} local={local} delay={34} from="up" drift={0} />
        </div>
      </div>
    }
  />
);

/** The agent, and the tools it leaves open for everything else. */
export const Agent: React.FC<Beat> = ({ local }) => (
  <Split
    copy={
      <Copy
        local={local}
        kicker="Automatic"
        accent={V.gold}
        head={
          <>
            Or hand it to the <Gold>agent</Gold>
          </>
        }
        sub="Upload your screenshots, say what you want, and it builds the project, on your own API key, on the Claude or ChatGPT account you already pay for, or on a free local model"
        extra={
          <Sub local={local} delay={62} size={25} color={V.teal}>
            And 42 tools, so Claude Code, Cursor or VS Code can drive the editor themselves
          </Sub>
        }
      />
    }
    visual={
      <div style={{ position: "relative", width: 1000, height: 560 }}>
        {/* The real dialog, soft, for context. What it says is on top of it */}
        <div style={{ position: "absolute", inset: 0, filter: "blur(3px)", opacity: 0.4 }}>
          <Shot src="ui-agent" width={1000} local={local} delay={6} from="right" drift={0.02} />
        </div>
        <div style={{ position: "absolute", left: 40, top: 96 }}>
          <PromptCard local={local} delay={16} width={840}>
            Put my screenshots into a clean dark template and write copy for a habit tracker
            called Droply
          </PromptCard>
        </div>
        <Terminal
          local={local}
          delay={64}
          width={880}
          style={{ position: "absolute", left: 90, top: 356 }}
        >
          claude mcp add open-screenshot-generator
        </Terminal>
      </div>
    }
  />
);
