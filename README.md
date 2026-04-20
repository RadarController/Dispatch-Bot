# Dispatch-Bot
Aviation-themed Discord operations bot for stream notifications, community management, and utility commands.

---

## Commands

### General

- `/ping`  
  Check that Dispatch Bot is online.

---

### Status / Diagnostics

- `/status bot`  
  Show Dispatch Bot runtime health, store status, live monitor status, and configured integrations.

- `/status guild`  
  Show this server’s configured feature status, including live announcements, welcome messages, and role panel setup.

- `/status live`  
  Show the live monitor status for this server, including currently active live sessions.

---

### Airport / Aviation Utilities

- `/airport icao:<icao>`  
  Show a combined airport panel for a four-letter ICAO airport code, including METAR, ATIS, ATC, and quick links to ChartFox and VATSIM Radar.  
  Example: `/airport icao:EGCC`

- `/airport icao:<icao> section:<section>`  
  Show a focused airport panel for one section only.  
  Supported sections: `overview`, `metar`, `atis`, `atc`, `charts`  
  Examples:  
  - `/airport icao:EGCC section:metar`  
  - `/airport icao:EGLL section:atis`  
  - `/airport icao:EHAM section:atc`  
  - `/airport icao:KJFK section:charts`

- `/callsign <callsign>`  
  Show the aircraft type and filed route for a VATSIM callsign.  
  Example: `/callsign BAW123`

#### Deprecated commands

- `/atis <icao>`  
  Deprecated. Returns a panel telling users to use `/airport`.

- `/metar <icao>`  
  Deprecated. Returns a panel telling users to use `/airport`.

- `/atc <icao>`  
  Deprecated. Returns a panel telling users to use `/airport`.

---

### Callsign Generation

- `/createcallsign <flight_number> [departure] [destination]`  
  Generate an ICAO callsign from an IATA flight number using the server’s configured IATA → ICAO root mappings.  
  Examples:  
  - `/createcallsign BA123`  
  - `/createcallsign BA123 EGLL KJFK`

- `/callsignconfig set-mapping <iata> <icao_root>`  
  Set an IATA to ICAO root mapping for this server.  
  Example: `/callsignconfig set-mapping BA BAW`

- `/callsignconfig remove-mapping <iata>`  
  Remove an IATA to ICAO root mapping from this server.  
  Example: `/callsignconfig remove-mapping BA`

- `/callsignconfig list-mappings`  
  List all configured IATA to ICAO root mappings for this server.

---

### Streamer Management

- `/streamer add [user] [display_name]`  
  Register yourself, or another member, as a streamer.

- `/streamer remove [user]`  
  Remove yourself, or another member, from the streamer registry.

- `/streamer list`  
  List all registered streamers in the server.

- `/channel add <platform> <url> [user]`  
  Add or update a linked streaming channel for a registered streamer.

- `/channel remove <platform> [user]`  
  Remove a linked channel from a streamer.

- `/channel list [user]`  
  List the linked channels for a streamer.

- `/liveconfig status`  
  Show the current live announcement configuration.

- `/liveconfig set-streamer-role <role>`  
  Set the Discord role automatically assigned to registered streamers.

- `/liveconfig set-alert-role <role>`  
  Set the role to ping when someone goes live.

- `/liveconfig set-channel <channel>`  
  Set the channel used for live announcements.

---

### Schedule Posts

#### Admin configuration

- `/schedule config status`  
  Show the current schedule configuration for this server.

- `/schedule config set-channel <channel>`  
  Set the channel where creator schedules will be posted.  
  Supports forum channels, text channels, and announcement channels.

- `/schedule config set-mode <forum_post|thread>`  
  Choose whether schedules are created as forum posts or message threads.

- `/schedule config set-creator-role <role>`  
  Set the role that allows members to manage their own schedule.

- `/schedule config set-title-format <format>`  
  Set the schedule title format.  
  Supported tokens: `{displayName}`, `{username}`

- `/schedule config clear`  
  Clear the schedule configuration for this server.

#### Creator schedule management

- `/schedule status`  
  Show your schedule status, including whether you already have a post or thread.

- `/schedule create`  
  Create your schedule post or thread, or update it if it already exists.

- `/schedule set <day> <text>`  
  Set one day of your schedule.  
  Supported days: `monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday`

- `/schedule remove <day>`  
  Clear one day from your schedule.

- `/schedule clear`  
  Clear all of your saved schedule entries.

- `/schedule publish`  
  Create or update your schedule post or thread from the saved schedule data.

- `/schedule refresh`  
  Refresh your existing schedule post or thread.

---

### Welcome Messages

- `/welcome status`  
  Show the current welcome message configuration for this server.

- `/welcome enable`  
  Enable welcome messages for this server.

- `/welcome disable`  
  Disable welcome messages for this server.

- `/welcome set-channel <channel>`  
  Set the channel used for welcome messages.

- `/welcome set-rules-channel <channel>`  
  Set the rules or info channel referenced by welcome messages.

- `/welcome clear-rules-channel`  
  Clear the configured rules or info channel.

- `/welcome set-mentions <enabled>`  
  Choose whether welcome messages mention the new member.

- `/welcome add <message>`  
  Add a custom welcome message template for this server.  
  Supported placeholders: `{user}`, `{server}`, `{rules}`, `{count}`

- `/welcome remove <index>`  
  Remove a custom welcome message by number.

- `/welcome list`  
  List the active welcome messages for this server.

- `/welcome clear-custom`  
  Clear all custom welcome messages and fall back to the built-in aviation-themed list.

- `/welcome test [member]`  
  Preview a welcome message without posting it.

---

### Self-Assignable Roles

- `/roles list`  
  List all self-assignable roles.

- `/roles add <role>`  
  Add one of the approved self-assignable roles to yourself.

- `/roles remove <role>`  
  Remove one of the approved self-assignable roles from yourself.

- `/roles toggle <role>`  
  Toggle one of the approved self-assignable roles on yourself.

- `/roles panel`  
  Create or refresh the managed role panel in the configured channel.

- `/roles config-status`  
  Show the current role panel configuration for this server.

- `/roles config-set-channel <channel>`  
  Set the channel used for the managed role panel in this server.

- `/roles config-add-role <role>`  
  Add a self-assignable role for this server.

- `/roles config-remove-role <role>`  
  Remove a self-assignable role for this server.

- `/roles config-clear`  
  Clear the role panel channel and self-assignable roles for this server.

---

## Permission Notes

- `/status`, `/liveconfig`, `/callsignconfig`, and `/welcome` are server-management commands intended for members with **Manage Server** permission.
- `/schedule config ...` commands require **Manage Server** permission.
- `/schedule` creator commands require the configured **creator role** for that server. Members with **Manage Server** permission can also use them.
- `/roles` configuration and panel management require **Manage Roles** permission.
- `/streamer` and `/channel` can be used on your own record, or on other users if you have **Manage Server** permission.

---

## Setup Notes

- Welcome messages rely on the Discord `guildMemberAdd` event.
- The bot must have `GatewayIntentBits.GuildMembers` enabled in code.
- **Server Members Intent** must also be enabled in the Discord Developer Portal under **Bot > Privileged Gateway Intents**.
- The combined `/airport` command includes fixed link buttons for **Charts** (ChartFox) and **Radar** (VATSIM Radar).
- `/schedule` supports:
  - **Forum channels** in `forum_post` mode
  - **Text or announcement channels** in `thread` mode
- Creator schedules are stored per user, per guild, and update the same post or thread instead of creating duplicates.