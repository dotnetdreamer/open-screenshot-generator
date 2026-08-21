import React from "react";
import { Img, staticFile } from "remotion";
import {
  CollabBoard,
  DashCard,
  DateChip,
  Gold,
  Head,
  Monitors,
  Shot,
  Split,
  Sub,
  Teal,
  Underline,
} from "./ui";

type Beat = { local: number; len: number };

/** Copy block for the release beats: the date first, because that is the point. */
const Copy: React.FC<{
  local: number;
  date: string;
  head: React.ReactNode;
  sub: React.ReactNode;
}> = ({ local, date, head, sub }) => (
  <>
    <DateChip local={local} delay={0}>
      {date}
    </DateChip>
    <div style={{ marginTop: 22 }}>
      <Head local={local} delay={6} size={66}>
        {head}
      </Head>
    </div>
    <div style={{ marginTop: 18 }}>
      <Underline local={local} delay={22} width={170} />
    </div>
    <div style={{ marginTop: 20 }}>
      <Sub local={local} delay={18} size={27}>
        {sub}
      </Sub>
    </div>
  </>
);

const LIFT = -58; // room at the bottom for the release rail

export const Languages: React.FC<Beat> = ({ local }) => (
  <Split
    offsetY={LIFT}
    copy={
      <Copy
        local={local}
        date="12 August"
        head={
          <>
            One project, <Teal>every language</Teal>
          </>
        }
        sub="Add the languages you file in and the layout is shared, while text, fonts and screenshots can differ, with machine translations to start from"
      />
    }
    visual={
      <Shot src="ui-languages" width={760} local={local} delay={10} from="right" drift={0.03} />
    }
  />
);

export const Fonts: React.FC<Beat> = ({ local }) => (
  <Split
    offsetY={LIFT}
    side="left"
    copy={
      <Copy
        local={local}
        date="11 August"
        head={
          <>
            Bring your <Gold>own fonts</Gold>
          </>
        }
        sub="Import a font file and it sits in the list beside the built in families, and a line breaks exactly where you put the break"
      />
    }
    visual={<Shot src="ui-fonts" width={400} local={local} delay={10} from="left" drift={0.03} />}
  />
);

export const SaveAnywhere: React.FC<Beat> = ({ local }) => (
  <Split
    offsetY={LIFT}
    copy={
      <Copy
        local={local}
        date="25 July and 6 August"
        head={
          <>
            Save it <Gold>where you keep things</Gold>
          </>
        }
        sub="Your Google Drive, your GitHub, or straight up to App Store Connect and Google Play with your own developer credentials"
      />
    }
    visual={<Shot src="ui-save" width={560} local={local} delay={10} from="right" drift={0.02} />}
  />
);

export const CloudLink: React.FC<Beat> = ({ local }) => (
  <Split
    offsetY={LIFT}
    side="left"
    copy={
      <Copy
        local={local}
        date="17 August"
        head={
          <>
            Carry on from <Teal>another machine</Teal>
          </>
        }
        sub="Signed in, the open project keeps itself saved, and one link hands anybody their own editable copy of the design"
      />
    }
    visual={<Shot src="ui-share" width={500} local={local} delay={10} from="left" drift={0.02} />}
  />
);

export const Versions: React.FC<Beat> = ({ local }) => (
  <Split
    offsetY={LIFT}
    copy={
      <Copy
        local={local}
        date="19 August"
        head={
          <>
            Every checkpoint <Gold>kept</Gold>
          </>
        }
        sub="On open, as you work, before a device conversion and on every export, and any of them goes back in one click, or opens as a copy"
      />
    }
    visual={<Shot src="ui-versions" width={620} local={local} delay={10} from="right" drift={0.02} />}
  />
);

export const Collab: React.FC<Beat> = ({ local }) => (
  <Split
    offsetY={LIFT}
    side="left"
    gap={70}
    copy={
      <Copy
        local={local}
        date="19 August"
        head={
          <>
            Edit together, <Teal>live</Teal>
          </>
        }
        sub="Share > Edit together hands out one link, everyone works on the same project with their own cursor, and the design travels straight between the browsers in the session"
      />
    }
    visual={<CollabBoard local={local} delay={10} />}
  />
);

export const Discover: React.FC<Beat> = ({ local }) => (
  <Split
    offsetY={LIFT}
    copyWidth={560}
    copy={
      <Copy
        local={local}
        date="14 and 20 August"
        head={
          <>
            See what everyone <Gold>else shipped</Gold>
          </>
        }
        sub="A community feed of store graphics, every post openable as a starting point, on a backend you host yourself and run from your own dashboard"
      />
    }
    visual={
      <div style={{ position: "relative" }}>
        <Shot src="ui-discover" width={980} local={local} delay={10} from="right" />
        <DashCard local={local} delay={44} style={{ position: "absolute", right: -40, bottom: -86 }} />
      </div>
    }
  />
);

export const Panels: React.FC<Beat> = ({ local }) => (
  <Split
    offsetY={LIFT - 10}
    copyWidth={540}
    copy={
      <Copy
        local={local}
        date="21 August"
        head={
          <>
            Panels on your <Teal>other screen</Teal>
          </>
        }
        sub="Properties, History, Versions and Layers open in a window of their own, on whichever display you point them at, still driving the same project"
      />
    }
    visual={
      <Monitors
        local={local}
        delay={10}
        scale={0.82}
        main={
          <Img
            src={staticFile("features/ui-canvas.png")}
            style={{ display: "block", width: "100%" }}
          />
        }
        side={
          <Img
            src={staticFile("features/ui-detached.png")}
            style={{ display: "block", width: "100%" }}
          />
        }
      />
    }
  />
);
