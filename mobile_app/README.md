# Smelter Editor Companion App

## Important disclaimers

### Untested on iOS. Use at your own peril

## Description

A companion app for [Smelter Editor](https://github.com/smelter-labs/smelter-editor), designed to run on a tablet alongside the editor web client. Connects to a Smelter instance via WebSocket and lets you view and manage inputs and layouts from a touch-first interface.

## Setup

After cloning the repo, run

- `npx expo install`
- `npx expo prebuild`
- `npx expo run:android --port 2137` (port can be whatever you want, but it defaults to 8081, same as the web app). Alternatively, download the latest release from the repository.

Make sure you have a Smelter Editor instance running (both server and editor). Create a room.

On the Join screen, enter the server IP and port (e.g. `192.168.1.10:3001`) in the URL field and tap the connect icon, or tap a previously saved address from the list below. The app will fetch available rooms. Select a room and tap **Join Room**. You can also scan a QR code from the editor web client to skip both steps.

## UI structure

```mermaid
flowchart TD
    Help["❓ Help Screen"]

    subgraph JoinRoom ["Join Room Screen"]
        JR_Main["Server list · Room picker"]
        JR_Settings["⚙ Settings modal\nGrid factor · Arrow nav"]
        JR_Help["❓ help button"]
    end

    subgraph App ["App Session  (swipe horizontally / arrow buttons)"]
        direction LR

        subgraph Layout ["Layout"]
            L_Main["Grid view"]
            L_Cog["⚙ cog"]
            L_Help["❓ help"]
        end

        subgraph Inputs ["Inputs"]
            I_Main["Card grid"]
            I_Cog["⚙ cog"]
            I_Help["❓ help"]
        end

        subgraph Timeline ["Timeline"]
            T_Main["(coming soon)"]
            T_Cog["⚙ cog"]
            T_Help["❓ help"]
        end

        subgraph Debug ["Debug"]
            D_Main["Connection info"]
            D_Cog["⚙ cog"]
            D_Help["❓ help"]
        end

        Layout <-->|swipe| Inputs
        Inputs <-->|swipe| Timeline
        Timeline <-->|swipe| Debug
    end

    JR_Main ==>|"Join Room"| Layout
    App -.->|"WS disconnect"| JoinRoom

    JR_Settings --> JR_Main
    JR_Help -->|navigate| Help

    L_Cog --> L_Main
    I_Cog --> I_Main
    T_Cog --> T_Main
    D_Cog --> D_Main

    L_Help -->|navigate| Help
    I_Help -->|navigate| Help
    T_Help -->|navigate| Help
    D_Help -->|navigate| Help

    Help -->|back| App
    Help -->|back| JoinRoom

    style Layout fill:#1E293B,stroke:#38BDF8,stroke-width:2px
    style Inputs fill:#063E3B,stroke:#10B981,stroke-width:2px
    style Timeline fill:#1E1B4B,stroke:#818CF8,stroke-width:2px
    style Debug fill:#171717,stroke:#6B7280,stroke-width:2px
    style App fill:none,stroke:#9ca3af,stroke-dasharray:5 5
    style Help fill:#292524,stroke:#d97706,stroke-width:2px
    style JoinRoom fill:none,stroke:#9ca3af,stroke-dasharray:5 5
Make sure you got a smelter editor instance running, both the server and the editor. Create a room.
If the instance is not on localhost, you can join a room via a QR code. Otherwise you need to fill in the url by hand. Include protocol (ws or wss), ip and port of the node.js server (3001 by default). Press the join button next to the input field - if the server is available, it will get saved for the future. You can then pick the room you want by its name. Alternatively, if the room is private, you can press "Join a private room instead".

Then, press the "join as editor" button. The app will try to connect to `ws(s)://<IP_WITH_PORT>/room/<ROOM_ID>/ws`. It will display an activity indicator while it does so - might take a while.
After that, it should be visible as "Mobile App" in the peers section of the Smelter Editor.

Alternatively, if you want to connect as source of video, press "Join as Camera"

## UI structure and usage

```mermaid
flowchart LR
    JoinRoom["<b>Join Room</b><br/>(Server URL, Room ID)"]
    Camera["<b>Camera Screen</b><br/>(WHIP streaming)"]
    Help["Help Screen"]

    subgraph App ["App Session (3-finger swipe horizontally)"]
        direction LR
        Layout["Layout Screen"]
        Inputs["Inputs Screen"]
        Timeline["Timeline Screen ⚠️"]
        Debug["Debug Screen"]

        Layout <-->|"3-finger swipe"| Inputs
        Inputs <-->|"3-finger swipe"| Timeline
        Timeline <-->|"3-finger swipe"| Debug
    end

    JoinRoom ==>|"Join as Editor"| Layout
    JoinRoom ==>|"Join as Camera"| Camera
    JoinRoom -->|"? button"| Help
    Camera -.->|"back / disconnect"| JoinRoom
    Help -.->|"back"| JoinRoom
    App -.->|"WS disconnect (any screen)"| JoinRoom

    style Layout fill:#1E293B,stroke:#38BDF8,stroke-width:3px
    style Inputs fill:#063E3B,stroke:#10B981,stroke-width:3px
    style Timeline fill:#1E1B4B,stroke:#818CF8,stroke-width:3px
    style Debug fill:#171717,stroke:#6B7280,stroke-width:3px
    style Camera fill:#1E1040,stroke:#A78BFA,stroke-width:3px
    style Help fill:#171717,stroke:#6B7280,stroke-width:2px
    style App fill:none,stroke:#9ca3af,stroke-dasharray: 5 5
```

```mermaid
%%{init: {'flowchart': {'curve': 'basis'}} }%%
flowchart LR
    Main["<b>Layout Screen</b><br/>(Grid Canvas)"]

    subgraph Overlays ["Overlays"]
        Layers["Layers Panel<br/>(Visibility / Add / Delete)"]
        Settings["Settings Panel<br/>(Grid Config / Resolution)"]
        Effects["Effects Panel<br/>(Per-input effects)"]
    end

    Main -->|"tap LAYERS chip"| Layers
    Layers -->|"tap backdrop"| Main

    Main -->|"cog button"| Settings
    Settings -->|"tap backdrop"| Main

    Main -->|"long-press grid item"| Effects
    Effects -->|"tap backdrop"| Main

    style Main fill:#1E293B,stroke:#38BDF8,stroke-width:3px
    style Layers fill:#334155,stroke:#38BDF8,stroke-width:3px
    style Settings fill:#334155,stroke:#38BDF8,stroke-width:3px
    style Effects fill:#334155,stroke:#38BDF8,stroke-width:3px
    style Overlays fill:#1E293B,stroke:#3b82f6,stroke-dasharray: 3 3
```

```mermaid
%%{init: {'flowchart': {'curve': 'basis'}} }%%
flowchart LR
    Main["<b>Inputs Screen</b><br/>(Source Cards — draggable)"]

    subgraph Overlays ["Overlays"]
        Panel["Input Detail Panel<br/>(volume · mute · layer)"]
        Settings["Settings Panel<br/>(columns · sort · arrow nav)"]
    end

    Main -->|"tap card"| Panel
    Panel -->|"tap backdrop"| Main

    Main -->|"long-press + drag"| Main
    Main -->|"cog button"| Settings
    Settings -->|"tap backdrop"| Main

    style Main fill:#063E3B,stroke:#10B981,stroke-width:3px
    style Panel fill:#065F46,stroke:#10B981,stroke-width:3px
    style Settings fill:#065F46,stroke:#10B981,stroke-width:3px
    style Overlays fill:#063E3B,stroke:#3b82f6,stroke-dasharray: 3 3
```

```mermaid
%%{init: {'flowchart': {'curve': 'basis'}} }%%
flowchart LR
    Main["<b>Camera Screen</b><br/>(WHIP Streaming)"]

    subgraph States ["Connection States"]
        direction LR
        Idle["Idle"]
        Preview["Preview<br/>(live camera feed)"]
        Connecting["Connecting<br/>(WebRTC handshake)"]
        Streaming["Streaming"]
        Error["Error"]
    end

    subgraph Overlays ["Overlays"]
        Log["Connection Log Modal<br/>(ICE / WebRTC debug)"]
    end

    Main --> Idle
    Idle -->|"grant permissions"| Preview
    Preview -->|"Start Stream"| Connecting
    Connecting -->|"WebRTC connected"| Streaming
    Connecting -->|"failure"| Error
    Streaming -->|"Stop"| Preview
    Error -->|"retry"| Connecting

    Main -->|"log icon"| Log
    Log -->|"close"| Main

    style Main fill:#1E1040,stroke:#A78BFA,stroke-width:3px
    style Idle fill:#1E1040,stroke:#A78BFA,stroke-width:2px
    style Preview fill:#1E1040,stroke:#A78BFA,stroke-width:2px
    style Connecting fill:#1E1040,stroke:#FBBF24,stroke-width:2px
    style Streaming fill:#1E1040,stroke:#34D399,stroke-width:2px
    style Error fill:#1E1040,stroke:#F87171,stroke-width:2px
    style Log fill:#2D1B69,stroke:#A78BFA,stroke-width:2px
    style States fill:none,stroke:#A78BFA,stroke-dasharray: 3 3
    style Overlays fill:none,stroke:#A78BFA,stroke-dasharray: 3 3
```
