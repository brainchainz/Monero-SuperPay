package printer

import (
	"fmt"
	"net"
	"strings"
	"time"
)

// ESC/POS command constants
var (
	Init         = []byte{0x1B, 0x40}          // Initialize printer
	Cut          = []byte{0x1D, 0x56, 0x00}    // Full cut
	PartialCut   = []byte{0x1D, 0x56, 0x01}    // Partial cut
	BoldOn       = []byte{0x1B, 0x45, 0x01}    // Bold on
	BoldOff      = []byte{0x1B, 0x45, 0x00}    // Bold off
	AlignCenter  = []byte{0x1B, 0x61, 0x01}    // Center align
	AlignLeft    = []byte{0x1B, 0x61, 0x00}    // Left align
	AlignRight   = []byte{0x1B, 0x61, 0x02}    // Right align
	DoubleHeight = []byte{0x1B, 0x21, 0x10}    // Double height
	DoubleWidth  = []byte{0x1B, 0x21, 0x20}    // Double width
	DoubleBoth   = []byte{0x1B, 0x21, 0x30}    // Double height + width
	NormalSize   = []byte{0x1B, 0x21, 0x00}    // Normal size
	LineFeed     = []byte{0x0A}                // Line feed
	FeedAndCut   = []byte{0x0A, 0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x00} // Feed 4 lines then cut
)

// ReceiptData holds the structured data for a receipt
type ReceiptData struct {
	BusinessName   string
	OrderNumber    string
	CreatedAt      string
	CustomerName   string
	Items          []ReceiptItem
	SubtotalFiat   float64
	TaxFiat        float64
	TotalFiat      float64
	CurrencySymbol string
	TotalXMR       string
	PaymentAddress string
	Status         string
	PaidAt         string
	Note           string
}

// ReceiptItem represents a line item on the receipt
type ReceiptItem struct {
	Name     string
	Quantity float64
	Total    float64
	Note     string
}

// GenerateReceipt creates ESC/POS binary data for a receipt
func GenerateReceipt(data ReceiptData) []byte {
	var buf []byte
	lineWidth := 48 // Standard 80mm thermal paper width in characters

	buf = append(buf, Init...)

	// Business name - centered, bold, large
	buf = append(buf, AlignCenter...)
	buf = append(buf, DoubleBoth...)
	buf = append(buf, BoldOn...)
	buf = append(buf, []byte(data.BusinessName)...)
	buf = append(buf, LineFeed...)
	buf = append(buf, NormalSize...)
	buf = append(buf, BoldOff...)

	// Dashed line
	buf = appendDash(buf, lineWidth)

	// Order number and date
	buf = append(buf, AlignLeft...)
	buf = appendTwoColumn(buf, "Order "+data.OrderNumber, data.CreatedAt, lineWidth)

	// Customer name
	if data.CustomerName != "" {
		buf = append(buf, []byte("Customer: "+data.CustomerName)...)
		buf = append(buf, LineFeed...)
	}

	// Dashed line
	buf = appendDash(buf, lineWidth)

	// Items
	for _, item := range data.Items {
		name := item.Name
		if item.Quantity > 1 {
			name = fmt.Sprintf("%s x%.0f", item.Name, item.Quantity)
		}
		price := fmt.Sprintf("%s%.2f", data.CurrencySymbol, item.Total)
		buf = appendTwoColumn(buf, name, price, lineWidth)
		if item.Note != "" {
			buf = append(buf, []byte("  * "+item.Note)...)
			buf = append(buf, LineFeed...)
		}
	}

	// Dashed line
	buf = appendDash(buf, lineWidth)

	// Subtotal and tax (if applicable)
	if data.TaxFiat > 0 {
		buf = appendTwoColumn(buf, "Subtotal", fmt.Sprintf("%s%.2f", data.CurrencySymbol, data.SubtotalFiat), lineWidth)
		buf = appendTwoColumn(buf, "Tax", fmt.Sprintf("%s%.2f", data.CurrencySymbol, data.TaxFiat), lineWidth)
	}

	// Total - bold, larger
	buf = append(buf, BoldOn...)
	buf = append(buf, DoubleHeight...)
	buf = appendTwoColumn(buf, "TOTAL", fmt.Sprintf("%s%.2f", data.CurrencySymbol, data.TotalFiat), lineWidth)
	buf = append(buf, NormalSize...)
	buf = append(buf, BoldOff...)

	// XMR amount
	if data.TotalXMR != "" && data.TotalXMR != "0" {
		buf = append(buf, LineFeed...)
		buf = append(buf, AlignCenter...)
		buf = append(buf, BoldOn...)
		buf = append(buf, []byte("Paid with Monero (XMR)")...)
		buf = append(buf, LineFeed...)
		buf = append(buf, []byte(data.TotalXMR+" XMR")...)
		buf = append(buf, LineFeed...)
		buf = append(buf, BoldOff...)
		if data.PaymentAddress != "" {
			// Print address in smaller chunks for readability
			addr := data.PaymentAddress
			for len(addr) > lineWidth {
				buf = append(buf, []byte(addr[:lineWidth])...)
				buf = append(buf, LineFeed...)
				addr = addr[lineWidth:]
			}
			if len(addr) > 0 {
				buf = append(buf, []byte(addr)...)
				buf = append(buf, LineFeed...)
			}
		}
		buf = append(buf, AlignLeft...)
	}

	// Dashed line
	buf = appendDash(buf, lineWidth)

	// Status
	buf = append(buf, AlignCenter...)
	buf = append(buf, BoldOn...)
	buf = append(buf, []byte(data.Status)...)
	buf = append(buf, LineFeed...)
	buf = append(buf, BoldOff...)

	// Paid at
	if data.PaidAt != "" {
		buf = append(buf, []byte("Paid: "+data.PaidAt)...)
		buf = append(buf, LineFeed...)
	}

	// Note
	if data.Note != "" {
		buf = appendDash(buf, lineWidth)
		buf = append(buf, AlignLeft...)
		buf = append(buf, []byte("Note: "+data.Note)...)
		buf = append(buf, LineFeed...)
	}

	// Footer
	buf = appendDash(buf, lineWidth)
	buf = append(buf, AlignCenter...)
	buf = append(buf, []byte("Powered by Monero SuperPay")...)
	buf = append(buf, LineFeed...)
	buf = append(buf, []byte("Thank you!")...)
	buf = append(buf, LineFeed...)

	// Feed and cut
	buf = append(buf, FeedAndCut...)

	return buf
}

// PrintToNetwork sends ESC/POS data to a network thermal printer
func PrintToNetwork(host string, port string, data []byte) error {
	addr := net.JoinHostPort(host, port)
	conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		return fmt.Errorf("failed to connect to printer at %s: %w", addr, err)
	}
	defer conn.Close()

	conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

	_, err = conn.Write(data)
	if err != nil {
		return fmt.Errorf("failed to send data to printer: %w", err)
	}

	return nil
}

func appendDash(buf []byte, width int) []byte {
	buf = append(buf, []byte(strings.Repeat("-", width))...)
	buf = append(buf, LineFeed...)
	return buf
}

func appendTwoColumn(buf []byte, left, right string, width int) []byte {
	spaces := width - len(left) - len(right)
	if spaces < 1 {
		spaces = 1
	}
	buf = append(buf, []byte(left+strings.Repeat(" ", spaces)+right)...)
	buf = append(buf, LineFeed...)
	return buf
}
