#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>

int main(void) {
    @autoreleasepool {
        NSData *data = [NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile];
        CGImageSourceRef source = CGImageSourceCreateWithData((__bridge CFDataRef)data, NULL);
        if (source == NULL) return 2;

        NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, NULL));
        NSUInteger width = [properties[(__bridge NSString *)kCGImagePropertyPixelWidth] unsignedIntegerValue];
        NSUInteger height = [properties[(__bridge NSString *)kCGImagePropertyPixelHeight] unsignedIntegerValue];
        if (!width || !height || width > 1920 || height > 1920) {
            CFRelease(source);
            return 2;
        }
        CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
        CFRelease(source);
        if (image == NULL) return 2;

        VNRecognizeTextRequest *request = [VNRecognizeTextRequest new];
        request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        request.usesLanguageCorrection = YES;
        NSArray<NSString *> *supported = [request supportedRecognitionLanguagesAndReturnError:NULL];
        NSMutableArray<NSString *> *languages = [NSMutableArray array];
        for (NSString *language in @[@"en-US", @"zh-Hans", @"zh-Hant"]) {
            if ([supported containsObject:language]) [languages addObject:language];
        }
        if (languages.count) request.recognitionLanguages = languages;
        if (@available(macOS 13.0, *)) request.automaticallyDetectsLanguage = YES;
        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
        CGImageRelease(image);
        if (![handler performRequests:@[request] error:NULL]) return 1;

        NSMutableArray<NSString *> *lines = [NSMutableArray array];
        for (VNRecognizedTextObservation *observation in request.results) {
            NSString *line = [observation topCandidates:1].firstObject.string;
            if (line.length > 240) {
                NSRange range = [line rangeOfComposedCharacterSequencesForRange:NSMakeRange(0, 240)];
                line = [line substringWithRange:range];
            }
            if (line.length) [lines addObject:line];
            if (lines.count >= 48) break;
        }
        NSData *output = [NSJSONSerialization dataWithJSONObject:lines options:0 error:NULL];
        if (output == nil) return 1;
        [NSFileHandle.fileHandleWithStandardOutput writeData:output];
        return 0;
    }
}
