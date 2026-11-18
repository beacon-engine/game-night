package server

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

// Phones only let a page read the motion sensors (tilt to steer) over HTTPS, and nobody on a home
// Wi-Fi can get a certificate for 192.168.x.x, so we sign our own. Each phone warns about it once
// per certificate, which is why it's kept in the user's folder and reused rather than made anew.
const (
	certFile     = "pad-cert.pem"
	certKeyFile  = "pad-key.pem"
	certLifetime = 397 * 24 * time.Hour // (the most Apple accepts)
	certRenew    = 30 * 24 * time.Hour  // make a new one when it has less than this left
)

// PadCert is the certificate in dir, or a new one (saved there) when there isn't one, it's near its
// end, or it doesn't name host (the machine moved to another network). With no dir it's made fresh
// each run.
func PadCert(dir, host string) (tls.Certificate, error) {
	if dir != "" {
		if c, err := tls.LoadX509KeyPair(filepath.Join(dir, certFile), filepath.Join(dir, certKeyFile)); err == nil &&
			time.Until(c.Leaf.NotAfter) > certRenew && c.Leaf.VerifyHostname(host) == nil {
			return c, nil
		}
	}
	certPEM, keyPEM, err := newCert(host)
	if err != nil {
		return tls.Certificate{}, err
	}
	if dir != "" {
		// best effort: if it can't be saved, phones just warn again next time
		if os.MkdirAll(dir, 0o755) == nil && os.WriteFile(filepath.Join(dir, certKeyFile), keyPEM, 0o600) == nil {
			os.WriteFile(filepath.Join(dir, certFile), certPEM, 0o644)
		}
	}
	return tls.X509KeyPair(certPEM, keyPEM)
}

func newCert(host string) (certPEM, keyPEM []byte, err error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, nil, err
	}
	now := time.Now()
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "Beacon Arcade", Organization: []string{"Beacon Arcade"}},
		NotBefore:             now.Add(-time.Hour), // (a phone's clock may be a little behind)
		NotAfter:              now.Add(certLifetime),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1)},
	}
	if ip := net.ParseIP(host); ip != nil {
		tmpl.IPAddresses = append(tmpl.IPAddresses, ip)
	} else if host != "" && host != "localhost" {
		tmpl.DNSNames = append(tmpl.DNSNames, host)
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, nil, err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), nil
}
