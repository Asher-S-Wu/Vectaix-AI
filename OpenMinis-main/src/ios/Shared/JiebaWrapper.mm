//
//  JiebaWrapper.mm
//  Minis
//
//  ObjC++ bridge to CppJieba. Built on MixSegment (Cut) + QuerySegment
//  (CutForSearch) sharing one DictTrie + HMMModel, rather than the full
//  `cppjieba::Jieba` facade: that facade's ctor also constructs a KeywordExtractor
//  which eagerly LoadIdfDict()s and `assert(lineno)`s on a missing/empty idf file.
//  Using it would (a) force us to bundle an extra ~6MB idf.utf8 + stop_words.utf8
//  we never use, and (b) hard-abort the app when those files aren't in the bundle
//  (its empty-path fallback resolves to "../dict/idf.utf8" relative to the CWD,
//  which never exists on iOS). MixSegment/QuerySegment need only the two files we
//  do bundle: jieba.dict.utf8 + hmm_model.utf8.
//

#import "JiebaWrapper.h"

#include <exception>
#include <memory>
#include <string>
#include <vector>

// Prefixed with cppjieba/ so they resolve against the
// $(SRCROOT)/Vendor/cppjieba/include header search path. cppjieba's own headers
// include their siblings unqualified ("MPSegment.hpp"), which clang resolves
// relative to the including header's own directory — so no extra search path is
// needed for the library's internals.
#include "cppjieba/DictTrie.hpp"
#include "cppjieba/HMMModel.hpp"
#include "cppjieba/MixSegment.hpp"
#include "cppjieba/PosTagger.hpp"
#include "cppjieba/QuerySegment.hpp"

@implementation JiebaWrapper {
    // Loaded once in -init and owned for the process lifetime. _dict/_model must
    // outlive the segmenters (which hold raw pointers into them) — ivars are
    // destroyed in reverse declaration order, so declaring them FIRST means they
    // are torn down LAST. Do not reorder.
    std::unique_ptr<cppjieba::DictTrie> _dict;
    std::unique_ptr<cppjieba::HMMModel> _model;
    std::unique_ptr<cppjieba::MixSegment> _mixSeg;
    std::unique_ptr<cppjieba::QuerySegment> _querySeg;
    BOOL _isReady;
}

@synthesize isReady = _isReady;

+ (instancetype)shared {
    static JiebaWrapper *instance;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[JiebaWrapper alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _isReady = NO;

        // Resolve against the bundle that actually contains this class FIRST, then
        // fall back to the main bundle. In the app they are the same thing, but in
        // a unit-test bundle -mainBundle is the test runner / host app, not the
        // xctest bundle the dictionary is copied into — looking only at mainBundle
        // made the tests silently fall back to NLTokenizer.
        NSBundle *bundle = [NSBundle bundleForClass:[JiebaWrapper class]];
        NSString *dictPath = [bundle pathForResource:@"jieba.dict" ofType:@"utf8"];
        NSString *hmmPath = [bundle pathForResource:@"hmm_model" ofType:@"utf8"];
        if (dictPath.length == 0 || hmmPath.length == 0) {
            NSBundle *main = [NSBundle mainBundle];
            if (dictPath.length == 0) dictPath = [main pathForResource:@"jieba.dict" ofType:@"utf8"];
            if (hmmPath.length == 0) hmmPath = [main pathForResource:@"hmm_model" ofType:@"utf8"];
        }

        if (dictPath.length == 0 || hmmPath.length == 0) {
            NSLog(@"[JiebaWrapper] dictionary resources missing (dict=%@ hmm=%@) — jieba disabled; "
                  @"TextSegmenter falls back to NLTokenizer", dictPath, hmmPath);
            return self;
        }

        // cppjieba throws (and asserts) on malformed/unreadable dictionaries.
        // Degrade to NLTokenizer instead of taking the whole app down.
        try {
            _dict = std::unique_ptr<cppjieba::DictTrie>(
                new cppjieba::DictTrie(std::string(dictPath.UTF8String)));
            _model = std::unique_ptr<cppjieba::HMMModel>(
                new cppjieba::HMMModel(std::string(hmmPath.UTF8String)));
            _mixSeg = std::unique_ptr<cppjieba::MixSegment>(
                new cppjieba::MixSegment(_dict.get(), _model.get()));
            _querySeg = std::unique_ptr<cppjieba::QuerySegment>(
                new cppjieba::QuerySegment(_dict.get(), _model.get()));
            _isReady = YES;
        } catch (const std::exception &e) {
            NSLog(@"[JiebaWrapper] failed to load jieba dictionary: %s — falling back to NLTokenizer",
                  e.what());
            _querySeg.reset();
            _mixSeg.reset();
            _model.reset();
            _dict.reset();
            _isReady = NO;
        }
    }
    return self;
}

- (NSArray<NSString *> *)segment:(NSString *)text {
    if (text.length == 0 || !_isReady) return @[];
    const char *utf8 = text.UTF8String;
    if (utf8 == NULL) return @[];
    std::string input(utf8);
    std::vector<std::string> words;
    _mixSeg->Cut(input, words, /*hmm=*/true);
    return [JiebaWrapper arrayFromWords:words];
}

- (NSArray<NSArray<NSString *> *> *)posTag:(NSString *)text {
    if (text.length == 0 || !_isReady) return @[];
    const char *utf8 = text.UTF8String;
    if (utf8 == NULL) return @[];
    std::string input(utf8);
    // PosTagger is stateless — it resolves tags through the segmenter's DictTrie — so we
    // construct one per call rather than keeping an ivar. MixSegment satisfies the
    // SegmentTagged interface it needs.
    cppjieba::PosTagger tagger;
    std::vector<std::pair<std::string, std::string>> tagged;
    tagger.Tag(input, tagged, *_mixSeg);

    NSMutableArray<NSArray<NSString *> *> *result = [NSMutableArray arrayWithCapacity:tagged.size()];
    for (const auto &pair : tagged) {
        NSString *word = [NSString stringWithUTF8String:pair.first.c_str()];
        NSString *tag = [NSString stringWithUTF8String:pair.second.c_str()];
        if (word != nil && tag != nil) {
            [result addObject:@[word, tag]];
        }
    }
    return result;
}

- (NSArray<NSString *> *)segmentForSearch:(NSString *)text {
    if (text.length == 0 || !_isReady) return @[];
    const char *utf8 = text.UTF8String;
    if (utf8 == NULL) return @[];
    std::string input(utf8);
    std::vector<std::string> words;
    _querySeg->Cut(input, words, /*hmm=*/true);
    return [JiebaWrapper arrayFromWords:words];
}

+ (NSArray<NSString *> *)arrayFromWords:(const std::vector<std::string> &)words {
    NSMutableArray<NSString *> *result = [NSMutableArray arrayWithCapacity:words.size()];
    for (const auto &w : words) {
        NSString *s = [NSString stringWithUTF8String:w.c_str()];
        if (s != nil) {
            [result addObject:s];
        }
    }
    return result;
}

@end
