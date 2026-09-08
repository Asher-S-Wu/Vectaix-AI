//
//  JiebaWrapper.h
//  Minis
//
//  Thin ObjC wrapper around CppJieba (header-only C++), bridged to Swift. Lazily
//  loads the ~5MB dictionary + HMM model from the bundle on first use
//  (dispatch_once, thread-safe) and reuses one shared segmenter for the process
//  lifetime. The C++ types live only in JiebaWrapper.mm, so this header stays
//  pure ObjC and is safe to import from MinisApp-Bridging-Header.h.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface JiebaWrapper : NSObject

/// Shared, lazily-initialized instance. First access loads the bundled dictionary.
+ (instancetype)shared;

/// Standard "mix" segmentation (MPSegment + HMM for out-of-vocabulary words),
/// suitable for display / general tokenization. Empty array for empty/whitespace
/// input, or if the dictionary failed to load.
- (NSArray<NSString *> *)segment:(NSString *)text;

/// Search-engine segmentation (finer granularity — long words are also split into
/// their sub-words), suitable for building a search index. Empty array for
/// empty/whitespace input, or if the dictionary failed to load.
- (NSArray<NSString *> *)segmentForSearch:(NSString *)text;

/// Part-of-speech tags for each token: `@[@[token, tag], …]` (tags are jieba's, e.g.
/// nr=person, ns=place, nz=other proper noun, nt=organisation).
///
/// Used by the voice-correction vocabulary builder to spot proper nouns — those are the
/// terms an ASR is most likely to get wrong and least likely to appear in a background
/// word-frequency list. Reuses the DictTrie already loaded for segmentation, so this adds
/// no extra dictionary resource.
- (NSArray<NSArray<NSString *> *> *)posTag:(NSString *)text;

/// YES once the bundled dictionary + HMM model have loaded. The Swift facade reads
/// this to fall back to NLTokenizer if the resources are missing, rather than
/// silently returning nothing.
@property (nonatomic, readonly) BOOL isReady;

@end

NS_ASSUME_NONNULL_END
