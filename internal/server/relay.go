package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"regexp"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// Relay connects one display (the game on the TV) with any number of pads (phones).
//
//	pad -> display: everything a pad sends, tagged with its id
//	display -> pad: messages with a "to" field go to that pad
//
// The relay also gives each pad a slot (P1, P2...) that it keeps across games and reconnects.
// Message shapes are in web/platform/protocol.ts.
type Relay struct {
	mu      sync.Mutex
	display *client
	pads    map[string]*pad
	slots   map[string]int // the last slot each pad id had
}

type client struct {
	conn *websocket.Conn
	out  chan []byte
}

type pad struct {
	*client
	name string
	slot int
}

// the fields of a message the relay looks at
type envelope struct {
	T    string `json:"t"`
	Role string `json:"role"`
	ID   string `json:"id"`
	Name string `json:"name"`
	To   string `json:"to"`
}

func NewRelay() *Relay {
	return &Relay{pads: map[string]*pad{}, slots: map[string]int{}}
}

func (r *Relay) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	conn, err := websocket.Accept(w, req, nil)
	if err != nil {
		return
	}
	c := &client{conn: conn, out: make(chan []byte, 64)}
	ctx, cancel := context.WithCancel(req.Context())
	defer cancel()
	go c.writeLoop(ctx)
	go c.heartbeat(ctx)

	var role string
	var padID string
	defer func() { r.disconnect(c, role, padID) }()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var m envelope
		if json.Unmarshal(data, &m) != nil {
			continue
		}
		switch {
		case m.T == "hello" && m.Role == "display":
			role = "display"
			r.helloDisplay(c)
		case m.T == "hello":
			role = "pad"
			padID = r.helloPad(c, m.ID, m.Name)
		case role == "pad":
			r.fromPad(padID, m, data)
		case role == "display" && m.To != "":
			r.mu.Lock()
			if p := r.pads[m.To]; p != nil {
				p.send(data)
			}
			r.mu.Unlock()
		}
	}
}

func (r *Relay) helloDisplay(c *client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.display != nil && r.display != c {
		// the newest screen wins; the old one is told why, so it doesn't reconnect and take over again
		go r.display.conn.Close(StatusReplaced, "another screen opened Beacon Arcade") // (waits for the goodbye: not under the lock)
	}
	r.display = c
	for id, p := range r.pads {
		c.sendJSON(map[string]any{"t": "join", "id": id, "name": p.name, "slot": p.slot})
		p.sendJSON(map[string]any{"t": "display", "on": true})
	}
}

var validID = regexp.MustCompile(`^[a-z0-9]{6,24}$`)

func (r *Relay) helloPad(c *client, id, name string) string {
	if !validID.MatchString(id) {
		id = newID()
	}
	name = truncate(name, 12)
	r.mu.Lock()
	defer r.mu.Unlock()
	if old := r.pads[id]; old != nil && old.client != c {
		go old.conn.Close(websocket.StatusNormalClosure, "reconnected")
	}
	p := &pad{client: c, name: name, slot: r.slotFor(id)}
	r.pads[id] = p
	r.slots[id] = p.slot
	p.sendJSON(map[string]any{"t": "welcome", "id": id, "slot": p.slot, "display": r.display != nil})
	r.display.sendJSON(map[string]any{"t": "join", "id": id, "name": name, "slot": p.slot})
	log.Printf("[pad] P%d %s connected (%d total)", p.slot+1, displayName(name, id), len(r.pads))
	return id
}

// A returning pad gets its old slot back if it's still free; otherwise the lowest free one.
// Call with r.mu held.
func (r *Relay) slotFor(id string) int {
	used := map[int]bool{}
	for other, p := range r.pads {
		if other != id {
			used[p.slot] = true
		}
	}
	if s, ok := r.slots[id]; ok && !used[s] {
		return s
	}
	s := 0
	for used[s] {
		s++
	}
	return s
}

func (r *Relay) fromPad(id string, m envelope, data []byte) {
	// forward it tagged with the pad's id
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return
	}
	fields["id"], _ = json.Marshal(id)
	tagged, _ := json.Marshal(fields)
	r.mu.Lock()
	defer r.mu.Unlock()
	if m.T == "name" {
		if p := r.pads[id]; p != nil {
			p.name = truncate(m.Name, 12)
		}
	}
	r.display.send(tagged)
}

func (r *Relay) disconnect(c *client, role, padID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	switch role {
	case "display":
		if r.display == c {
			r.display = nil
			for _, p := range r.pads {
				p.sendJSON(map[string]any{"t": "display", "on": false})
			}
		}
	case "pad":
		if p := r.pads[padID]; p != nil && p.client == c {
			delete(r.pads, padID)
			r.display.sendJSON(map[string]any{"t": "leave", "id": padID})
			log.Printf("[pad] P%d %s left (%d total)", p.slot+1, displayName(p.name, padID), len(r.pads))
		}
	}
}

// Messages go out through a buffered queue so one slow phone can't hold up the others.
// If the queue is full the message is dropped: pads resend their state twice a second anyway.
func (c *client) send(data []byte) {
	if c == nil {
		return
	}
	select {
	case c.out <- data:
	default:
	}
}

func (c *client) sendJSON(v any) {
	if c == nil {
		return
	}
	data, _ := json.Marshal(v)
	c.send(data)
}

// Runs until the connection's context ends (the read loop returned)
func (c *client) writeLoop(ctx context.Context) {
	for {
		select {
		case data := <-c.out:
			if c.conn.Write(ctx, websocket.MessageText, data) != nil {
				return
			}
		case <-ctx.Done():
			return
		}
	}
}

// A phone that went to sleep or dropped off the Wi-Fi, or a page frozen in the browser's
// cache, never says goodbye: ping every few seconds and hang up on anyone who doesn't answer,
// so they don't keep their slot (or the display) forever. They get it back when they return.
func (c *client) heartbeat(ctx context.Context) {
	tick := time.NewTicker(heartbeat)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			pctx, cancel := context.WithTimeout(ctx, heartbeat)
			err := c.conn.Ping(pctx)
			cancel()
			if err != nil {
				c.conn.CloseNow()
				return
			}
		}
	}
}

const heartbeat = 4 * time.Second

// Close code sent to a display when another one takes over (see protocol.ts)
const StatusReplaced websocket.StatusCode = 4000

func newID() string {
	b := make([]byte, 6)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		r = r[:n]
	}
	return string(r)
}

func displayName(name, id string) string {
	if name != "" {
		return name
	}
	return id
}
