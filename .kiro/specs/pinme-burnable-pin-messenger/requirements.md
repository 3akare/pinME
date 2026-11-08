# Requirements Document

## Introduction

PinMe is a web messenger that brings back the PIN-based identity of BBM (2005-2019). Users chat with anyone using an 8-character PIN instead of a phone number. This matters in Nigeria, where a phone number is tied to NIN, BVN, bank OTPs and mobile money. PinMe adds burnable PINs: one user holds several labeled PINs, and burning a PIN permanently cuts off every contact who only knew that PIN. No server-side account links a person's PINs, so those contacts never learn who the user really is.

Messages are end-to-end encrypted in the browser. The server acts only as a directory of public data and a relay of ciphertext, and deletes ciphertext after delivery. The MVP covers requirements 1 to 17 and the constraint requirements 18 to 20. Requirements 21 to 24 are optional and out of the MVP.

Non-goals: voice or video calls, phone or email login of any kind, and server-side message history.

Known limitation: the MVP has no forward secrecy (see Requirement 22 and Requirement 20).

## Glossary

- **PinMe_Client**: The browser application (TanStack Start React front end) running on a user's device.
- **PinMe_Server**: The single Cloudflare Worker deployment, comprising page routes, server functions and the WebSocket router.
- **PinMailbox**: The Cloudflare Durable Object, one instance per PIN, that holds live WebSocket connections and undelivered ciphertext for that PIN.
- **Directory**: The Neon Postgres database holding the PIN directory, public keys, invites, accepted contact pairs and burned PINs. It never holds messages.
- **Local_Store**: The IndexedDB storage in the browser holding private keys, contacts and message history.
- **Crypto_Module**: The PinMe_Client module that is the only code using libsodium.
- **Identity**: A locally created browser identity consisting of a display name, an optional display picture and a set of PINs. It exists only in the browser.
- **PIN**: A unique 8-character identifier of uppercase hexadecimal characters (for example 2A4F9C1B).
- **PIN_Label**: A user-chosen text label for a PIN (for example "Friends", "Marketplace").
- **Active_PIN**: A PIN that has been registered and not burned.
- **Burned_PIN**: A PIN that has been permanently destroyed. A Burned_PIN is never reissued.
- **Contact**: Another PIN that has accepted an invite pair with a given own PIN.
- **Invite**: A pending request from one PIN to another PIN to become Contacts.
- **Ciphertext_Envelope**: A message payload consisting of recipient PIN, ciphertext, nonce and message ID.
- **Message_ID**: A client-generated UUID identifying one message.
- **Challenge**: A random value sent by a PinMailbox on WebSocket connect, which the client must sign.
- **Delivery_Marker**: The status indicator on a sent message: clock (sending), D (delivered to the recipient device) or R (read).
- **PING**: A PING!!! alert that makes the recipient window shake, plays a sound and vibrates the device where supported.
- **Typing_Indicator**: The text "Name is writing a message..." shown while a Contact is typing.
- **Presence_Status**: A user-selected value of Available or Busy per PIN.
- **Personal_Message**: A short public text set per PIN and visible to Contacts.
- **Broadcast**: One message sent individually encrypted to all Contacts of a chosen PIN.
- **Barcode**: A QR code, styled in BBM-inspired style, encoding a PIN.
- **Ghost_Animation**: The animation played when a PIN is burned.
- **Protocol_Schema**: A Zod schema in src/shared defining a WebSocket message or server function input.
- **Signed_Request**: A server function request carrying a signature made with the PIN's Ed25519 private key.

## Requirements

### Requirement 1: Local identity creation

**User Story:** As a new user, I want to start chatting without a phone number or email, so that I keep my personal details private.

#### Acceptance Criteria

1. WHEN a user opens PinMe for the first time in a browser, THE PinMe_Client SHALL display a form with a display name field and an optional display picture field, and SHALL NOT display any field requesting a phone number or email address.
2. WHEN the user submits a display name of 1 to 32 characters, THE PinMe_Client SHALL create the Identity in the Local_Store within 2 seconds.
3. WHEN the Identity is created, THE PinMe_Client SHALL create exactly one first PIN with the PIN_Label "Main".
4. WHEN the first PIN is created, THE PinMe_Client SHALL display the PIN and its Barcode on the screen shown immediately after identity creation.
5. IF the submitted display name is empty, consists only of whitespace, or is longer than 32 characters, THEN THE PinMe_Client SHALL reject the submission, display a validation message stating the allowed length of 1 to 32 characters, and create no Identity in the Local_Store.
6. WHERE a display picture is supplied, THE PinMe_Client SHALL accept an image of at most 256 KB.
7. IF a supplied display picture is larger than 256 KB or is not an image file, THEN THE PinMe_Client SHALL reject the picture, display a validation message stating the size limit of 256 KB and the image-only requirement, and retain the entered display name in the form.
8. THE PinMe_Server SHALL NOT receive, store, or log any phone number or email address.

### Requirement 2: PIN generation and registration

**User Story:** As a user, I want each PIN to be unique and random, so that nobody can guess or reuse my PIN.

#### Acceptance Criteria

1. WHEN a PIN is created, THE PinMe_Client SHALL generate a PIN of exactly 8 characters, each drawn from the set 0-9 and A-F, using a cryptographically secure random source.
2. WHEN a PIN is created, THE Crypto_Module SHALL generate one X25519 key pair for encryption and one Ed25519 key pair for ownership proof, both unique to that PIN and not reused for any other PIN.
3. WHEN a PIN is submitted for registration with a valid PIN format, two public keys, a display name of 1 to 32 characters, a Presence_Status and a Personal_Message of 0 to 80 characters, THE PinMe_Server SHALL store them in the Directory and return a success response to the PinMe_Client within 2 seconds.
4. IF a submitted PIN already exists in the Directory as an Active_PIN or a Burned_PIN, THEN THE PinMe_Server SHALL reject the registration with a collision error, leave the existing Directory entry unchanged, and store none of the submitted data.
5. IF the PinMe_Server rejects a registration with a collision error, THEN THE PinMe_Client SHALL discard the rejected PIN and its key pairs, generate a new PIN and new key pairs, and resubmit, for a maximum of 5 retries.
6. IF all 5 retries end in a collision error, THEN THE PinMe_Client SHALL stop retrying, store no PIN or private key in the Local_Store for this attempt, and show the user an error indicating that PIN creation failed.
7. IF a submitted registration has a malformed PIN, a missing or malformed public key, or a display name or Personal_Message outside the allowed length, THEN THE PinMe_Server SHALL reject the registration with a validation error and store no data in the Directory.
8. THE PinMe_Client SHALL keep every private key only in the Local_Store and SHALL NOT transmit any private key to the PinMe_Server.
9. THE PinMe_Server SHALL NOT store any data, including identifiers, keys, or metadata, that links one PIN to another PIN of the same user.

### Requirement 3: Multiple labeled PINs

**User Story:** As a user, I want several PINs with labels, so that I can share different PINs with different groups of people.

#### Acceptance Criteria

1. THE PinMe_Client SHALL allow a user to hold from 1 to 20 Active_PINs simultaneously, each with its own PIN_Label, key pairs and Contacts.
2. WHEN a user creates an additional PIN with a valid PIN_Label, THE PinMe_Client SHALL register the PIN and display it in the PIN manager within 2 seconds of registration completing.
3. IF a PIN_Label is empty, consists only of whitespace, or is longer than 24 characters, THEN THE PinMe_Client SHALL reject the label, display a validation message indicating the label must be 1 to 24 characters, and keep the PIN unregistered or the existing PIN_Label unchanged.
4. IF a user attempts to create a PIN while already holding 20 Active_PINs, THEN THE PinMe_Client SHALL reject the creation, display a message indicating the maximum number of Active_PINs has been reached, and leave the existing Active_PINs unchanged.
5. IF PIN registration fails, THEN THE PinMe_Client SHALL display an error message indicating the registration failed and SHALL NOT add the PIN to the PIN manager or the Local_Store.
6. WHEN a user renames a PIN to a valid PIN_Label, THE PinMe_Client SHALL update the PIN_Label in the Local_Store only, without sending the new PIN_Label to any remote service, and display the new PIN_Label in the PIN manager.
7. THE PinMe_Client SHALL display the PIN manager listing every Active_PIN with its PIN_Label and number of Contacts, showing 0 for an Active_PIN with no Contacts.

### Requirement 4: Invites and adding contacts by PIN

**User Story:** As a user, I want to add someone by entering their PIN, so that we can chat without exchanging phone numbers.

#### Acceptance Criteria

1. WHEN a user enters a valid PIN and sends an invite from one of their own active PINs, THE PinMe_Server SHALL create a pending Invite in the Directory and return a success confirmation to the sender within 2 seconds.
2. WHEN an Invite is created, THE PinMailbox of the invited PIN SHALL deliver an inviteNotice message to every connected socket of the invited PIN within 2 seconds.
3. IF an Invite is created while no socket of the invited PIN is connected, THEN THE PinMailbox SHALL hold the inviteNotice and deliver it within 2 seconds after the invited PIN next connects.
4. WHEN the invited user accepts an Invite, THE PinMe_Server SHALL record the accepted Contact pair in the Directory, remove the pending Invite, and notify the inviting PIN within 2 seconds.
5. WHEN the invited user declines an Invite, THE PinMe_Server SHALL delete the Invite without recording a Contact pair.
6. WHEN an Invite is accepted, THE PinMe_Client of both users SHALL open the chat for the Contact pair within 2 seconds of receiving the acceptance.
7. IF the entered PIN is not an 8-character uppercase hexadecimal string (characters 0-9 and A-F), THEN THE PinMe_Client SHALL reject the input with a validation message indicating the required format and SHALL NOT send the Invite to the PinMe_Server.
8. IF the entered PIN does not exist in the Directory, THEN THE PinMe_Server SHALL reject the Invite with a not-found error and SHALL NOT create an Invite.
9. IF the entered PIN is a Burned_PIN, THEN THE PinMe_Server SHALL reject the Invite with a burned error and SHALL NOT create an Invite.
10. IF the entered PIN equals the sender's own PIN, THEN THE PinMe_Server SHALL reject the Invite with an error indicating self-invites are not allowed and SHALL NOT create an Invite.
11. IF a pending Invite or accepted Contact pair already exists between the two PINs in either direction, THEN THE PinMe_Server SHALL reject the new Invite with a duplicate error and SHALL NOT create an Invite.
12. WHEN an Invite is accepted, THE PinMe_Client SHALL store the Contact's public keys in the Local_Store.
13. IF a PIN has already sent 10 Invites within the preceding 60 minutes, THEN THE PinMailbox SHALL reject further Invites from that PIN with a rate-limit error indicating the time remaining until the next Invite is allowed, and SHALL NOT create an Invite.

### Requirement 5: Barcode display and scanning

**User Story:** As a user, I want to show or scan a BBM-style barcode, so that I can add a contact in person without typing.

#### Acceptance Criteria

1. WHEN a user opens the detail view of an Active_PIN, THE PinMe_Client SHALL display a Barcode encoding that PIN's 8 uppercase hexadecimal characters, rendered at a minimum size of 200 by 200 CSS pixels, next to the PIN text.
2. WHEN a user chooses to scan, THE PinMe_Client SHALL request camera permission and, once granted, scan Barcodes using the device camera.
3. WHEN a scanned Barcode decodes to an 8-character uppercase hexadecimal string, THE PinMe_Client SHALL stop scanning within 1 second, close the camera, and open the add-contact flow with the PIN field prefilled with the scanned PIN.
4. IF camera permission is denied or no camera is available, THEN THE PinMe_Client SHALL display a message indicating the camera cannot be used, stop any scan attempt, and offer manual PIN entry.
5. IF the scanned content is not an 8-character uppercase hexadecimal string, THEN THE PinMe_Client SHALL reject the scan, display a message indicating the Barcode does not contain a valid PIN, leave the add-contact flow unchanged, and continue scanning.
6. FOR ALL valid PINs, encoding a PIN into a Barcode then decoding the Barcode SHALL produce the original PIN (round-trip property).
7. IF the scanned PIN equals one of the user's own Active_PINs, THEN THE PinMe_Client SHALL reject the scan, display a message indicating a user cannot add their own PIN, and continue scanning.
8. WHEN the user cancels scanning, THE PinMe_Client SHALL close the camera within 1 second and return to the previous screen without changing the add-contact flow.

### Requirement 6: Authenticated WebSocket connection

**User Story:** As a user, I want only the owner of a PIN to connect as that PIN, so that nobody can impersonate me.

#### Acceptance Criteria

1. WHEN the PinMe_Client activates an Active_PIN, THE PinMe_Client SHALL open exactly one WebSocket connection for that Active_PIN to the path /ws/:pin.
2. WHEN a WebSocket connects to /ws/:pin, THE PinMe_Server SHALL route the connection to the PinMailbox of that PIN.
3. WHEN a WebSocket connects to a registered, non-burned PIN, THE PinMailbox SHALL send exactly one Challenge containing 32 bytes of random data that is unique per connection.
4. WHEN the PinMe_Client receives a Challenge, THE PinMe_Client SHALL sign the Challenge with the Ed25519 private key of the PIN and send a challengeResponse containing the signature.
5. WHEN a challengeResponse arrives within 10 seconds of the Challenge being sent, THE PinMailbox SHALL verify the signature against the registered Ed25519 public key and mark the connection as authenticated if the signature is valid.
6. IF the signature is invalid, THEN THE PinMailbox SHALL close the connection and keep the connection unauthenticated.
7. IF no challengeResponse arrives within 10 seconds of the Challenge being sent, THEN THE PinMailbox SHALL close the connection.
8. WHILE a WebSocket connection is not authenticated, THE PinMailbox SHALL ignore every message other than challengeResponse and SHALL NOT deliver any stored or live messages on that connection.
9. IF a WebSocket connects for a Burned_PIN or an unregistered PIN, THEN THE PinMailbox SHALL send an error message indicating the PIN is unavailable and close the connection without sending a Challenge.
10. WHEN a WebSocket connection drops, THE PinMe_Client SHALL reconnect using exponentially increasing delay starting at 1 second, doubling after each failed attempt, capped at 30 seconds, and SHALL repeat the Challenge handshake on each new connection.
11. WHEN a reconnect attempt authenticates successfully, THE PinMe_Client SHALL reset the reconnect delay to 1 second.
12. THE PinMailbox SHALL use the WebSocket Hibernation API for client connections.

### Requirement 7: Encrypted one-to-one chat

**User Story:** As a user, I want to send real-time encrypted text messages, so that only my contact can read them.

#### Acceptance Criteria

1. WHEN a user sends a message of 1 to 4,096 characters, THE Crypto_Module SHALL encrypt the plaintext with crypto_box_easy using the recipient's X25519 public key, the sender's X25519 private key and a new random 24-byte nonce.
2. WHEN a message is sent, THE PinMe_Client SHALL generate a Message_ID as a UUID and send a Ciphertext_Envelope to the sender's PinMailbox.
3. WHEN the sender's PinMailbox receives a Ciphertext_Envelope from an authenticated socket, THE PinMailbox SHALL verify that the recipient is an accepted Contact and that the rate limit is not exceeded, and, if both checks pass, forward the Ciphertext_Envelope to the recipient's PinMailbox.
4. WHEN the recipient's PinMailbox receives a Ciphertext_Envelope while the recipient has at least one authenticated socket, THE PinMailbox SHALL deliver the envelope to all of those sockets.
5. WHEN the recipient's PinMailbox receives a Ciphertext_Envelope while the recipient has no authenticated socket, THE PinMailbox SHALL store the envelope in its Durable Object storage until it is delivered.
6. WHEN a stored envelope is delivered to the recipient's authenticated socket, THE PinMailbox SHALL delete the stored envelope.
7. WHEN the recipient's PinMe_Client receives an envelope, THE Crypto_Module SHALL decrypt it and THE PinMe_Client SHALL save the plaintext to the Local_Store.
8. IF decryption of a received envelope fails, THEN THE PinMe_Client SHALL discard the envelope, SHALL NOT save any record of it to the Local_Store, and SHALL display no content for it in the conversation.
9. IF the recipient is not an accepted Contact of the sender, THEN THE PinMailbox SHALL reject the message, SHALL NOT forward or store the envelope, and SHALL return an error to the sender indicating the recipient is not an accepted Contact.
10. IF a PIN sends more than 30 messages within any 10-second window, THEN THE PinMailbox SHALL reject each excess message, SHALL NOT forward or store it, and SHALL return an error to the sender indicating the rate limit was exceeded.
11. THE PinMe_Client SHALL save message history in the Local_Store only.
12. FOR ALL plaintext messages of 1 to 4,096 characters, encrypting then decrypting with the matching key pairs SHALL produce the original plaintext (round-trip property).
13. FOR ALL messages encrypted twice with the same keys and plaintext, THE Crypto_Module SHALL produce different nonces.

### Requirement 8: Delivery and read markers

**User Story:** As a user, I want D and R markers on my messages, so that I know whether my message arrived and was read.

#### Acceptance Criteria

1. WHEN a user sends a message, THE PinMe_Client SHALL show the clock Delivery_Marker on the message within 500 milliseconds of the send action.
2. WHEN the recipient's PinMe_Client saves a received message, THE PinMe_Client SHALL send a delivered message referencing the Message_ID within 5 seconds of saving.
3. WHEN the sender's PinMe_Client receives a delivered message for a Message_ID it sent, THE PinMe_Client SHALL change the Delivery_Marker of that message to D within 1 second of receipt.
4. WHEN the recipient opens the chat while the chat is visible and the PinMe_Client displays a received message, THE PinMe_Client SHALL send exactly one read message referencing the Message_ID within 5 seconds of display.
5. WHEN the sender's PinMe_Client receives a read message for a Message_ID it sent, THE PinMe_Client SHALL change the Delivery_Marker of that message to R within 1 second of receipt.
6. THE PinMe_Client SHALL display the Delivery_Marker at the right side of each sent message bubble, and SHALL NOT display a Delivery_Marker on received message bubbles.
7. THE PinMailbox SHALL relay delivered and read messages only between accepted Contacts.
8. IF a delivered or read message arrives from a sender who is not an accepted Contact, THEN THE PinMailbox SHALL discard the message, SHALL NOT relay it, and SHALL leave the Delivery_Marker of the referenced message unchanged.
9. IF a read message arrives for a Message_ID that has not reached D, THEN THE PinMe_Client SHALL set the Delivery_Marker directly to R.
10. IF a delivered or read message arrives referencing a Message_ID that does not match any sent message in the local chat, THEN THE PinMe_Client SHALL ignore the message and SHALL NOT change any Delivery_Marker.
11. FOR ALL messages, THE PinMe_Client SHALL never move a Delivery_Marker backward from R to D, from R to clock, or from D to clock, including when a delivered message arrives after a read message or when a duplicate delivered or read message arrives (monotonic invariant).

### Requirement 9: PING!!!

**User Story:** As a user, I want to send a PING!!! to get a contact's attention, so that I can reach them like in BBM.

#### Acceptance Criteria

1. WHEN a user presses the PING button in a chat with an accepted Contact, THE PinMe_Client SHALL send a ping message for that Contact to the PinMailbox within 1 second of the press.
2. WHEN the recipient's PinMe_Client receives a ping, THE PinMe_Client SHALL shake the chat window for 1 second and play the PING sound once.
3. WHERE the recipient's device supports vibration, THE PinMe_Client SHALL vibrate the device for 500 milliseconds when a ping is received.
4. THE PinMailbox SHALL accept at most one ping per Contact every 10 seconds per sending PIN.
5. IF a ping exceeds the rate limit, THEN THE PinMailbox SHALL reject the ping, return an error indicating the rate limit was exceeded together with the remaining wait time in seconds, and not deliver the ping to the recipient.
6. IF the PinMailbox returns a rate limit error, THEN THE PinMe_Client SHALL disable the PING button for that chat until the remaining wait time expires, and SHALL re-enable it when the wait time reaches 0 seconds.
7. IF the recipient is not an accepted Contact of the sender, THEN THE PinMailbox SHALL reject the ping, return an error indicating the recipient is not an accepted Contact, and not deliver the ping.
8. IF the recipient has no authenticated socket, THEN THE PinMailbox SHALL discard the ping without storing it and SHALL return a result to the sender indicating the ping was not delivered.
9. IF a ping is rejected or discarded, THEN THE PinMe_Client SHALL display an indication to the sender that the ping was not delivered within 2 seconds of receiving the result.

### Requirement 10: Typing indicator

**User Story:** As a user, I want to see when my contact is typing, so that I know a reply is coming.

#### Acceptance Criteria

1. WHEN a user enters or modifies text in the message input of an open conversation, THE PinMe_Client SHALL send a typing message to the Contact, and SHALL send no more than 1 typing message per 3-second interval per conversation.
2. WHEN the message input becomes empty or the user sends the message, THE PinMe_Client SHALL stop sending typing messages for that conversation.
3. WHEN the recipient's PinMe_Client receives a typing message from an accepted Contact whose conversation is open, THE PinMe_Client SHALL display the Typing_Indicator containing the Contact's display name within 500 milliseconds of receipt.
4. WHEN 5 seconds pass without a new typing message from the Contact, THE PinMe_Client SHALL hide the Typing_Indicator within 500 milliseconds.
5. WHEN a message from the Contact arrives in the conversation, THE PinMe_Client SHALL hide the Typing_Indicator within 500 milliseconds.
6. IF the sender is not an accepted Contact of the recipient, THEN THE PinMailbox SHALL reject the typing message, SHALL NOT forward it to the recipient, and SHALL return an error indication to the sender.
7. IF the recipient has no authenticated socket, THEN THE PinMailbox SHALL discard the typing message without storing it and SHALL NOT return an error indication to the sender.

### Requirement 11: Status and personal message

**User Story:** As a user, I want to set a status and a short personal message, so that my contacts know my availability.

#### Acceptance Criteria

1. THE PinMe_Client SHALL allow the user to set a Presence_Status of exactly one of Available or Busy for each PIN, with Available as the initial value for a newly created PIN.
2. THE PinMe_Client SHALL allow the user to set a Personal_Message of 0 to 80 characters for each PIN, where an empty Personal_Message clears the previously set message.
3. WHEN a user changes the Presence_Status or Personal_Message, THE PinMe_Client SHALL send a Signed_Request containing the new values to a server function within 2 seconds of the change being confirmed.
4. WHEN the server function receives a Signed_Request, THE PinMe_Server SHALL verify the signature against the registered Ed25519 public key before updating the Directory.
5. IF the signature is invalid or no registered Ed25519 public key exists for the PIN, THEN THE PinMe_Server SHALL reject the update, return an error indicating authentication failure, and leave the Directory unchanged.
6. WHEN the Directory is updated, THE PinMailbox SHALL push the new Presence_Status and Personal_Message to the PinMailbox of every Contact within 5 seconds, for delivery to that Contact's connected sockets.
7. WHEN a Contact's PinMailbox has no connected socket at push time, THE PinMailbox SHALL retain the latest Presence_Status and Personal_Message and deliver them when a socket next connects.
8. THE PinMe_Client SHALL display each Contact's Presence_Status as a status dot, using a distinct visual appearance for Available and for Busy, and SHALL show the Personal_Message in the contact row.
9. IF a Personal_Message exceeds 80 characters, THEN THE PinMe_Server SHALL reject the update, return an error indicating the message is too long, and leave the Directory unchanged.
10. IF the Signed_Request fails to reach the server or the server rejects it, THEN THE PinMe_Client SHALL display an error indicating the update failed and SHALL keep showing the last successfully saved Presence_Status and Personal_Message.

### Requirement 12: Broadcast message

**User Story:** As a user, I want to send one message to all contacts on a PIN, so that I can announce something once.

#### Acceptance Criteria

1. WHEN a user sends a Broadcast from a chosen PIN, THE PinMe_Client SHALL encrypt the message separately for each accepted Contact of that PIN, using a new random nonce for each envelope.
2. WHEN a Broadcast is sent, THE PinMe_Client SHALL generate a distinct Message_ID for each envelope and send one broadcast message containing exactly one Ciphertext_Envelope per accepted Contact, with at most 100 envelopes per broadcast message.
3. WHEN a PinMailbox receives a broadcast from an authenticated socket, THE PinMailbox SHALL process each envelope as an individual message, verifying that the recipient is an accepted Contact and that the rate limit of Requirement 7 is not exceeded, before forwarding the envelope.
4. WHEN a Contact receives a Broadcast envelope, THE PinMe_Client SHALL decrypt it, save it to the Local_Store and show it as a received message in the one-to-one chat with the sender.
5. WHEN a Broadcast is sent, THE PinMe_Client SHALL show a separate Delivery_Marker for each Contact on that Broadcast, starting at clock and following the transitions of Requirement 8.
6. IF a Broadcast contains an envelope for a PIN that is not an accepted Contact, THEN THE PinMailbox SHALL reject that envelope, return an error identifying the rejected recipient PIN and Message_ID to the sender, and continue to process the remaining envelopes.
7. THE PinMailbox SHALL count each Broadcast envelope as one message toward the message rate limit of Requirement 7.
8. IF an envelope in a Broadcast exceeds the message rate limit, THEN THE PinMailbox SHALL reject that envelope and all later envelopes of that broadcast message, forward the envelopes already accepted, and return an error identifying each rejected Message_ID.
9. IF the chosen PIN has no accepted Contacts, THEN THE PinMe_Client SHALL not send a broadcast message and SHALL show an error indicating that there are no recipients.
10. IF a broadcast message contains more than 100 envelopes, THEN THE PinMailbox SHALL reject the whole broadcast message, forward no envelopes, and return an error indicating that the envelope limit was exceeded.

### Requirement 13: Burn a PIN

**User Story:** As a user, I want to burn a PIN, so that everyone who only had that PIN is cut off permanently.

#### Acceptance Criteria

1. WHEN a user chooses to burn a PIN, THE PinMe_Client SHALL display a confirmation dialog that shows the PIN_Label, states that burning is permanent, and offers a confirm action and a cancel action.
2. WHEN the user cancels the confirmation dialog, THE PinMe_Client SHALL close the dialog and leave the PIN, its keys, Contacts and conversations unchanged.
3. WHEN the user confirms, THE PinMe_Client SHALL send a Signed_Request to the burn server function for that PIN.
4. WHEN the burn server function receives a valid Signed_Request for an active PIN, THE PinMe_Server SHALL mark the PIN as burned in the Directory and return a success response to the PinMe_Client within 5 seconds.
5. WHEN a PIN is marked burned, THE PinMailbox of that PIN SHALL close all its WebSocket connections, delete all queued messages and refuse every further connection.
6. WHEN a PIN is marked burned, THE PinMe_Server SHALL delete the Invites and Contact pairs involving that PIN from the Directory.
7. WHEN the PinMe_Client receives a success response to the burn request, THE PinMe_Client SHALL play the Ghost_Animation.
8. WHEN the Ghost_Animation completes, THE PinMe_Client SHALL delete the PIN's private keys, Contacts and conversations from the Local_Store.
9. WHEN a PIN is burned, THE PinMailbox of each former Contact SHALL send a contactBurned message identifying the burned PIN to every connected socket of that Contact, and SHALL hold the message for any Contact that is not connected until that Contact next connects.
10. WHEN a PinMe_Client receives a contactBurned message, THE PinMe_Client SHALL mark the chat with the burned PIN as unavailable and disable message input for that chat.
11. IF a message or Invite targets a Burned_PIN, THEN THE PinMe_Server SHALL reject it with an error indicating the PIN is burned, including when the sender previously was a Contact, and SHALL NOT store or deliver it.
12. IF the Signed_Request signature is invalid, THEN THE PinMe_Server SHALL reject the burn with an error indicating an invalid signature and leave the PIN active.
13. IF the burn request fails because of a network error or no response within 10 seconds, THEN THE PinMe_Client SHALL display an error message indicating the burn did not complete, SHALL NOT play the Ghost_Animation, and SHALL retain the PIN's keys, Contacts and conversations in the Local_Store.
14. THE PinMe_Server SHALL never reissue a Burned_PIN and SHALL reject registration of it.
15. WHEN a PIN is burned, THE PinMe_Server SHALL leave the other PINs of the same user unaffected.
16. FOR ALL burned PINs, burning the same PIN again SHALL leave the system state unchanged and return a success response (idempotence).

### Requirement 14: Contact list and chat UI

**User Story:** As a user, I want a BBM-style contact list and chat screen, so that the app feels familiar.

#### Acceptance Criteria

1. WHEN the home view loads, THE PinMe_Client SHALL display each Contact as a rounded row containing the display picture, display name, a status dot and the Personal_Message.
2. IF a Contact has no display picture, THEN THE PinMe_Client SHALL display a default placeholder image in the display picture position of that row.
3. IF a Personal_Message exceeds the width of its row, THEN THE PinMe_Client SHALL truncate it to a single line with an ellipsis, and THE PinMe_Client SHALL keep the row height unchanged.
4. WHEN the home view loads and at least one pending Invite exists, THE PinMe_Client SHALL display each pending Invite with an accept action and a decline action.
5. WHEN the user activates the accept action or the decline action on an Invite, THE PinMe_Client SHALL remove that Invite from the pending list within 1 second.
6. IF the accept or decline action fails, THEN THE PinMe_Client SHALL keep the Invite in the pending list and display an error message indicating the action failed.
7. WHEN a chat message is displayed, THE PinMe_Client SHALL render it as a bubble, with sent bubbles aligned to the right and carrying Delivery_Markers, and received bubbles aligned to the left without Delivery_Markers.
8. THE PinMe_Client SHALL use a dark theme with blue accents, with a text-to-background contrast ratio of at least 4.5:1 for message and contact text.
9. THE PinMe_Client SHALL provide a mobile-first responsive layout that remains usable at viewport widths from 320 px to 1920 px, with no horizontal scrolling and with all actions reachable.
10. THE PinMe_Client SHALL contain no BlackBerry logo and no exact copy of the BBM icon.
11. THE PinMe_Client SHALL provide routes for the home view, chat with a Contact by PIN, the PIN manager and add contact.
12. IF the user navigates to a chat route whose PIN matches no Contact, THEN THE PinMe_Client SHALL display a message indicating the Contact was not found and provide a link to the home view.

### Requirement 15: Input validation

**User Story:** As a maintainer, I want every message validated, so that malformed input cannot corrupt state.

#### Acceptance Criteria

1. THE PinMe_Client and PinMe_Server SHALL define every Protocol_Schema exactly once in src/shared and import that single definition on both sides.
2. WHEN a WebSocket message arrives at the PinMailbox, THE PinMailbox SHALL validate the message against the Protocol_Schema for its declared type before any state change or forwarding occurs.
3. WHEN a WebSocket message arrives at the PinMe_Client, THE PinMe_Client SHALL validate the message against the Protocol_Schema for its declared type before any state change or display occurs.
4. WHEN a server function receives input, THE PinMe_Server SHALL validate the input against the Protocol_Schema for that function before any state change occurs.
5. IF a message fails validation, THEN THE receiving side SHALL discard the message, leave all stored state unchanged, and return or log an error that identifies only the message type and the failed field name and excludes message content.
6. IF a WebSocket message is not valid JSON or has no recognized type value, THEN THE receiving side SHALL discard the message, leave all stored state unchanged, and return or log an error that excludes message content.
7. THE Protocol_Schema set SHALL cover exactly the types challenge, challengeResponse, message, delivered, read, typing, ping, broadcast, inviteNotice, contactBurned and error.
8. THE Protocol_Schema for a message SHALL reject any message whose ciphertext length exceeds 8192 bytes and SHALL accept a ciphertext length of 8192 bytes.
9. FOR ALL valid protocol messages, serializing to JSON then parsing with the Protocol_Schema SHALL produce a message deeply equal to the original (round-trip property).

### Requirement 16: Contacts-only relay

**User Story:** As a user, I want only my accepted contacts to reach me, so that strangers cannot spam me.

#### Acceptance Criteria

1. WHEN a PinMailbox receives a message, ping, typing, delivered or read item from a sender for relay, THE PinMailbox SHALL verify that the sender and recipient are an accepted Contact pair before relaying the item.
2. WHEN a Contact pair is added or removed, THE PinMailbox SHALL refresh its cached Contact pairs from the Directory within 5 seconds.
3. IF a sender is not an accepted Contact of the recipient, THEN THE PinMailbox SHALL drop the item without delivering it to the recipient, return an error to the sender indicating the recipient is not an accepted Contact, and store no part of the item.
4. WHEN the recipient's PinMailbox receives a forwarded item from another PinMailbox, THE PinMailbox SHALL verify the Contact pair independently of the forwarding PinMailbox's verification before accepting the item.
5. IF the Directory is unreachable and the Contact pair is not in the PinMailbox cache, THEN THE PinMailbox SHALL drop the item and return an error to the sender indicating that verification could not be completed.
6. IF a Contact pair has been removed, THEN THE PinMailbox SHALL treat the pair as not accepted for every item received after the removal is processed, including items from a cached pair.

### Requirement 17: Server privacy and data retention

**User Story:** As a user, I want the server to see only ciphertext, so that my conversations stay private.

#### Acceptance Criteria

1. WHEN a message is submitted to the PinMe_Server, THE PinMe_Server SHALL receive and store only the ciphertext, nonce, Message_ID and PIN for that message, and SHALL NOT receive or store the plaintext.
2. THE PinMe_Server SHALL store in the Directory only display name, Personal_Message, Presence_Status, public keys, Invites, Contact pairs and burned PIN records.
3. THE PinMe_Server SHALL NOT write plaintext, private keys or ciphertext to logs.
4. THE PinMe_Server SHALL NOT store messages in the Directory.
5. WHEN a Ciphertext_Envelope is delivered to a recipient socket, THE PinMailbox SHALL delete it from Durable Object storage within 5 seconds of delivery.
6. IF a request body contains a field named like a private key (for example privateKey or secretKey), THEN THE PinMe_Server SHALL reject the request with an error indicating that private keys are not accepted, SHALL NOT persist any part of the request payload, and SHALL NOT write the key to logs.
7. WHEN a stored Ciphertext_Envelope has been stored for more than 30 days, THE PinMailbox SHALL delete it within 24 hours after the 30-day mark.
8. IF deletion of a Ciphertext_Envelope from Durable Object storage fails, THEN THE PinMailbox SHALL retain the envelope and retry the deletion up to 3 times at intervals of 5 seconds, without re-delivering it to the recipient socket.

### Requirement 18: Platform and project constraints

**User Story:** As a maintainer, I want a defined technical stack and structure, so that the project is consistent and deployable.

#### Acceptance Criteria

1. THE PinMe project SHALL use TypeScript with the compiler option "strict" set to true, and SHALL define every type used by both client and server in src/shared, such that the type-check command completes with zero errors.
2. THE PinMe project SHALL use TanStack Start with React, deployed as a single Cloudflare Worker that serves pages, server functions and WebSocket connections.
3. WHEN a request arrives at the Worker entry src/worker.ts with a path matching /ws/:pin, THE PinMe_Server SHALL route the request to the PinMailbox Durable Object instance identified by that PIN.
4. WHEN a request arrives at the Worker entry src/worker.ts with a path that does not match /ws/:pin, THE PinMe_Server SHALL route the request to the TanStack Start handler, and src/worker.ts SHALL re-export PinMailbox.
5. THE PinMe project SHALL declare the PinMailbox Durable Object binding and its migration in wrangler.jsonc with the nodejs_compat flag enabled, such that the cf-typegen script completes with zero errors.
6. THE PinMe_Server SHALL access Neon Postgres through Drizzle and @neondatabase/serverless using the connection string held in the DATABASE_URL secret.
7. IF the DATABASE_URL secret is missing or empty when the PinMe_Server accesses the Directory, THEN THE PinMe_Server SHALL fail the request with an error indicating that the database is not configured, and SHALL not attempt a database connection.
8. THE PinMe project SHALL use Tailwind CSS for styling, Zustand for client state, libsodium-wrappers for encryption, idb for IndexedDB, Zod for validation, one QR generation library and one camera scanning library.
9. THE PinMe project SHALL use pnpm as its package manager and SHALL define the package.json scripts dev, build, deploy, test, lint, db:generate, db:migrate and cf-typegen.
10. THE PinMe project SHALL keep secrets in wrangler secrets or .dev.vars, and SHALL list .dev.vars in .gitignore so that it is excluded from version control.
11. THE PinMe project SHALL name the Directory tables exactly pins, invites, contacts and burned_pins.
12. THE PinMe project SHALL restrict imports of libsodium-wrappers to files under src/client/crypto and imports of idb to files under src/client/storage, such that the lint command reports an error for any import outside those directories.
13. THE PinMe project SHALL prevent files under src/durable, src/server and src/db from importing from src/client, such that the lint command reports an error for any such import.
14. THE PinMe project SHALL include Vitest tests for crypto helpers, protocol validation, rate limiting and burn logic, and the test script SHALL exit with code 0 when all of them pass.
15. WHEN a client sends a text message over a WebSocket connection to the hello-world echo Durable Object, THE PinMe_Server SHALL send the same text back over the same connection, and this echo SHALL be available before any other feature work depends on realtime.
16. THE PinMe_Client SHALL use the native WebSocket API wrapped in a reconnect helper.
17. IF a WebSocket connection closes unexpectedly, THEN THE PinMe_Client reconnect helper SHALL retry indefinitely using the delay schedule of Requirement 6 criteria 10 and 11.

### Requirement 19: Ownership proof for state changes

**User Story:** As a user, I want only me to be able to change or burn my PIN, so that attackers cannot tamper with it.

#### Acceptance Criteria

1. WHEN a server function changes a PIN (burn, status update, personal message update, display name update), THE PinMe_Server SHALL require a Signed_Request before applying the change.
2. THE Signed_Request SHALL include the PIN, the action, a timestamp in milliseconds since the Unix epoch, a nonce of at least 16 random bytes, and an Ed25519 signature covering all of those fields.
3. WHEN the PinMe_Server verifies a Signed_Request, THE PinMe_Server SHALL verify the signature with the Ed25519 public key registered for that PIN using WebCrypto.
4. IF a Signed_Request timestamp differs from server time by more than 60 seconds in either direction, THEN THE PinMe_Server SHALL reject it with an error indicating an expired or invalid timestamp.
5. IF a Signed_Request nonce was already used for that PIN within the previous 120 seconds, THEN THE PinMe_Server SHALL reject it with an error indicating a replay.
6. IF a Signed_Request is rejected for any reason, THEN THE PinMe_Server SHALL leave all stored data unchanged and return an error indicating the rejection reason category (invalid signature, expired timestamp, replay, or unknown PIN).
7. IF a Signed_Request references a PIN with no registered public key or a PIN that is already burned, THEN THE PinMe_Server SHALL reject it and leave all stored data unchanged.
8. FOR ALL Signed_Requests in which any single field (PIN, action, timestamp, or nonce) is modified after signing, THE PinMe_Server SHALL reject verification.
9. WHEN the PinMe_Server accepts a Signed_Request, THE PinMe_Server SHALL record its nonce for that PIN for at least 120 seconds.

### Requirement 20: Documented security limitations

**User Story:** As a user and judge, I want honest security documentation, so that I understand what PinMe does and does not protect.

#### Acceptance Criteria

1. THE PinMe project SHALL include a README in the repository root that contains a section stating that the MVP provides no forward secrecy, and that a later compromise of a private key allows decryption of any previously captured ciphertext encrypted to that key.
2. THE README SHALL include a section listing what the server can see, which comprises public data, PINs, ciphertext sizes and message timing, and a separate list of what the server cannot see, which comprises plaintext message content and private keys.
3. THE README SHALL include a section describing the Burn guarantee, stating that burning cuts off relay and directory access for the burned PIN, and stating that burning cannot erase messages already stored on contacts' devices.
4. THE README SHALL include setup steps, the commands to install, run locally, test and deploy PinMe, and the name and purpose of every secret or environment variable required, without including the secret values themselves.
5. IF a security property is not provided by the MVP, THEN THE README SHALL list it in a "Known limitations" section instead of omitting it or implying it is provided.

### Requirement 21: Group chats (Optional, out of MVP)

**User Story:** As a user, I want group chats, so that several contacts can talk together.

#### Acceptance Criteria

1. WHERE group chats are enabled, WHEN a user selects between 2 and 49 Contacts of a chosen PIN and submits a group name of 1 to 64 characters, THE PinMe_Client SHALL create a group containing the selected Contacts and the user, and SHALL display the group in the chat list within 2 seconds.
2. WHERE group chats are enabled, WHEN a user sends a message in a group, THE PinMe_Client SHALL encrypt the message separately for each current member other than the sender, so that each member's copy is decryptable only with that member's own key.
3. WHERE group chats are enabled, WHEN a member's PIN is burned, THE PinMe_Client SHALL remove that member from the group within 5 seconds, SHALL stop encrypting new group messages for that member, and SHALL display a notice to the remaining members that the member was removed.
4. WHERE group chats are enabled, IF a user attempts to create a group with fewer than 2 or more than 49 selected Contacts, or with an empty or over-64-character group name, THEN THE PinMe_Client SHALL reject the creation, SHALL display an error message indicating the violated limit, and SHALL retain the user's current selection and entered name.
5. WHERE group chats are enabled, IF encryption or delivery of a group message fails for one or more members, THEN THE PinMe_Client SHALL mark the message as failed for those members, SHALL display an error message identifying which members did not receive it, and SHALL leave delivery to the other members unaffected.

### Requirement 22: Forward secrecy (Optional, out of MVP)

**User Story:** As a user, I want forward secrecy, so that a later key compromise does not expose past messages.

#### Acceptance Criteria

1. WHERE forward secrecy is enabled, WHEN the Crypto_Module encrypts or decrypts a message, THE Crypto_Module SHALL derive a unique per-message key using a double ratchet, so that no two messages in a conversation share a message key.
2. WHERE forward secrecy is enabled, WHEN a message key has been used to encrypt or decrypt its message, THE Crypto_Module SHALL delete that message key from memory and persistent storage within 1 second, and SHALL NOT be able to decrypt the same message a second time using stored key material.
3. WHERE forward secrecy is enabled, WHEN a message arrives with a sequence number greater than the next expected number and the gap is 100 messages or fewer, THE PinMe_Client SHALL store the skipped message keys and decrypt the message, and SHALL decrypt each skipped message when it later arrives.
4. WHERE forward secrecy is enabled, IF a message arrives whose sequence number is more than 100 messages ahead of the next expected number, THEN THE PinMe_Client SHALL reject the message without decrypting it, SHALL display an error indicating the message could not be decrypted because too many messages were skipped, and SHALL leave the existing ratchet state unchanged.
5. WHERE forward secrecy is enabled, IF a message arrives whose message key has already been used or deleted, or whose decryption fails authentication, THEN THE PinMe_Client SHALL discard the message, SHALL display an error indicating the message could not be decrypted, and SHALL leave the existing ratchet state unchanged.

### Requirement 23: Encrypted backup and restore (Optional, out of MVP)

**User Story:** As a user, I want to back up my identity with a passphrase, so that I can restore it on a new browser.

#### Acceptance Criteria

1. WHERE backup is enabled, WHEN a user requests a backup and enters a passphrase of 12 to 128 characters, THE PinMe_Client SHALL produce a single backup file in which the Identity, private keys and Contacts are encrypted with a key derived from the passphrase, and the file contains no plaintext private key or Contact data.
2. WHERE backup is enabled, IF a user requests a backup with a passphrase shorter than 12 characters or longer than 128 characters, THEN THE PinMe_Client SHALL refuse to create the backup and display an error indicating the allowed passphrase length.
3. WHERE backup is enabled, WHEN a user restores a backup file with the correct passphrase, THE PinMe_Client SHALL recreate the Identity, private keys and Contacts in the Local_Store and display a success confirmation within 5 seconds for a backup containing up to 1,000 Contacts.
4. WHERE backup is enabled, IF the passphrase is wrong, THEN THE PinMe_Client SHALL reject the restore, display an error indicating that the passphrase is incorrect, and leave the Local_Store unmodified.
5. WHERE backup is enabled, IF the selected backup file is corrupted, truncated, or not a PinMe_Client backup, THEN THE PinMe_Client SHALL reject the restore, display an error indicating the file is invalid, and leave the Local_Store unmodified.
6. WHERE backup is enabled, IF the Local_Store already contains an Identity when a restore is requested, THEN THE PinMe_Client SHALL require explicit user confirmation before replacing it, and SHALL leave the Local_Store unmodified if the user declines.
7. WHERE backup is enabled, FOR ALL Identities, backing up then restoring with the same passphrase SHALL produce an Identity, private keys and Contacts equal to the originals (round-trip property).

### Requirement 24: Installable PWA and push notifications (Optional, out of MVP)

**User Story:** As a user, I want to install PinMe and receive notifications, so that I notice messages when the app is closed.

#### Acceptance Criteria

1. WHERE PWA support is enabled, THE PinMe_Client SHALL provide a web app manifest declaring an app name, an icon, a start URL, and a standalone display mode, and a registered service worker, such that the browser offers an install prompt on a supported browser over HTTPS.
2. WHERE PWA support is enabled, WHEN the user completes installation, THE PinMe_Client SHALL launch from the installed app icon in a standalone window without browser address bar.
3. WHERE push notifications are enabled, WHEN the user grants notification permission, THE PinMe_Client SHALL register a push subscription with the push service within 10 seconds.
4. WHERE push notifications are enabled, IF the user denies notification permission or push subscription registration fails, THEN THE PinMe_Client SHALL remain fully usable without push notifications and SHALL display a message indicating that notifications are disabled.
5. WHERE push notifications are enabled, WHEN a new message arrives while the PinMe_Client is closed or not in the foreground, THE PinMe_Client SHALL display a notification that contains only a generic text indicating a new message was received, with no message plaintext, no sender-provided content, and no message attachments.

### Requirement 25: Demo readiness

**User Story:** As a hackathon presenter, I want a smooth 3-minute two-window demo, so that judges see the main value quickly.

#### Acceptance Criteria

1. WHEN two browser windows run PinMe with separate browser storage, THE PinMe_Client SHALL operate each window as an independent device with its own identity, PIN list, and message history, such that no data created in one window is visible in the other except through the PinMe_Server.
2. THE PinMe project SHALL support the following demo flow completing in 180 seconds or less with no manual page reload and no error indication in either window: window A shows its PIN, window B adds it, window A accepts, both windows exchange messages with D then R markers, window A sends a PING that shakes window B, window A creates a "Marketplace" PIN, window B adds it, window A burns it with the Ghost_Animation, and window B can no longer message it.
3. WHEN a message is sent between two windows connected to the same deployment, THE PinMe_Client SHALL show the D marker in the sending window within 2 seconds of the send action under a network round-trip latency of 200 ms or less.
4. WHEN the burn of a PIN is confirmed while window B is connected, THE PinMe_Client in window B SHALL display that PIN's chat as unavailable and disable its message input within 2 seconds of the burn confirmation.
5. IF window B attempts to send a message to the burned PIN, THEN THE PinMe_Client SHALL reject the send, show an error indication that the PIN is no longer available, and add no message to the chat.
6. WHEN the demo flow has completed, THE PinMe_Server SHALL allow inspection of Directory contents and network traffic in which no message text, PIN label ("Marketplace"), or other plaintext user content appears.
