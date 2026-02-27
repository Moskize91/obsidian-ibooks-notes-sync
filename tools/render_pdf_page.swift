import Foundation
import PDFKit
import AppKit

func fail(_ message: String) -> Never {
    fputs("render_pdf_page error: \(message)\n", stderr)
    exit(1)
}

let args = CommandLine.arguments
if args.count < 5 {
    fail("usage: render_pdf_page.swift <pdf-path> <page-number-1-based> <output-png-path> <scale>")
}

let pdfPath = args[1]
let pageNumber = Int(args[2]) ?? 0
let outputPath = args[3]
let scale = CGFloat(Double(args[4]) ?? 2.0)

if pageNumber < 1 {
    fail("invalid page number")
}

let pdfUrl = URL(fileURLWithPath: pdfPath)
guard let document = PDFDocument(url: pdfUrl) else {
    fail("cannot open pdf: \(pdfPath)")
}

guard let page = document.page(at: pageNumber - 1) else {
    fail("cannot read page \(pageNumber)")
}

let annotations = page.annotations
let originalShouldDisplay = annotations.map { $0.shouldDisplay }
for annotation in annotations {
    let subtype = (annotation.type ?? "").lowercased()
    // Keep point-style note icons so users can visually locate note anchors.
    // Hide other built-in appearances (especially Popup) to avoid noisy large boxes.
    annotation.shouldDisplay =
        subtype == "text" ||
        subtype == "sound" ||
        subtype == "fileattachment" ||
        subtype == "stamp" ||
        subtype == "caret"
}
defer {
    for (index, annotation) in annotations.enumerated() {
        annotation.shouldDisplay = originalShouldDisplay[index]
    }
}

let bounds = page.bounds(for: .mediaBox)
let imageSize = NSSize(width: bounds.width * scale, height: bounds.height * scale)
let image = NSImage(size: imageSize)

image.lockFocus()
guard let context = NSGraphicsContext.current?.cgContext else {
    image.unlockFocus()
    fail("cannot create graphics context")
}

NSColor.white.setFill()
context.fill(CGRect(origin: .zero, size: imageSize))

context.saveGState()
context.scaleBy(x: scale, y: scale)
page.draw(with: .mediaBox, to: context)
context.restoreGState()

image.unlockFocus()

guard let tiffData = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiffData),
      let pngData = rep.representation(using: .png, properties: [:]) else {
    fail("cannot encode png")
}

let outputUrl = URL(fileURLWithPath: outputPath)
try FileManager.default.createDirectory(
    at: outputUrl.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
try pngData.write(to: outputUrl)
