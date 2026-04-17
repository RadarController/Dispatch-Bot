# Dispatch-Bot
Aviation-themed Discord operations bot for stream notifications, community management, and utility commands

---

## Commands

### General

- `/ping`  
  Check that Dispatch Bot is online.

---

### VATSIM / Aviation Utilities

- `/atis <icao>`  
  Show the current VATSIM arrival, departure, or general ATIS for a four-letter ICAO airport code.  
  Example: `/atis EGCC`

- `/metar <icao>`  
  Get the latest METAR for a four-letter ICAO airport code.  
  Example: `/metar EGLL`

- `/atc <icao>`  
  List online VATSIM ATC for an airport ICAO code, including top-down coverage where applicable.  
  Example: `/atc EHAM`

- `/callsign <callsign>`  
  Show the aircraft type and filed route for a VATSIM callsign.  
  Example: `/callsign BAW123`

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

- `/liveconfig` and `/callsignconfig` are server-management commands intended for members with **Manage Server** permission.
- `/roles` configuration and panel management require **Manage Roles** permission.
- `/streamer` and `/channel` can be used on your own record, or on other users if you have **Manage Server** permission.
