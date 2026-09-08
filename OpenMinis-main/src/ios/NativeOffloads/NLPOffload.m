//
//  NLPOffload.m
//  MinisApp
//
//  Native offload handler for `apple-nlp`.
//  Subcommands: language, tokenize, pos, ner, sentiment, embed, analyze
//

#import <Foundation/Foundation.h>
#import <NaturalLanguage/NaturalLanguage.h>
#import <UIKit/UIKit.h>
#import "NativeOffloadUtils.h"
#include "kernel/native_offload.h"
#include <unistd.h>

static NSString *const TOOL_NAME = @"apple-nlp";

static NSString *const HELP_TEXT =
    @"apple-nlp - Natural language processing using Apple NaturalLanguage framework\n"
     "\n"
     "USAGE:\n"
     "  apple-nlp <command> [options]\n"
     "\n"
     "COMMANDS:\n"
     "  language    Detect language of text\n"
     "  tokenize   Tokenize text into words, sentences, or paragraphs\n"
     "  pos        Part-of-speech tagging\n"
     "  ner        Named entity recognition\n"
     "  sentiment  Sentiment analysis\n"
     "  embed      Get text embeddings\n"
     "  analyze    Run all analyses at once\n"
     "\n"
     "COMMON OPTIONS:\n"
     "  --help, -h           Show this help message\n"
     "  --compact            Minimize JSON output\n"
     "  -q, --quiet          Output only data field\n"
     "  --text <string>      Input text (or pipe via stdin)\n"
     "\n"
     "TOKENIZE OPTIONS:\n"
     "  --unit <type>        Token unit: word, sentence, paragraph (default: word)\n"
     "\n"
     "SENTIMENT OPTIONS:\n"
     "  --per-sentence       Analyze each sentence separately\n"
     "\n"
     "EMBED OPTIONS:\n"
     "  --model <name>       Embedding model (default: auto-detect from language)\n"
     "\n"
     "EXAMPLES:\n"
     "  apple-nlp language --text \"Bonjour le monde\"\n"
     "  echo \"Hello world\" | apple-nlp tokenize\n"
     "  apple-nlp pos --text \"The quick brown fox jumps\"\n"
     "  apple-nlp ner --text \"Tim Cook announced at Apple Park in Cupertino\"\n"
     "  apple-nlp sentiment --text \"I love this product\" --per-sentence\n"
     "  apple-nlp embed --text \"hello\"\n"
     "  apple-nlp analyze --text \"Apple Inc. reported great earnings today.\"\n";

// ── Helper: get input text from --text arg or stdin ──

static NSString *get_input_text(int argc, char **argv, int stdin_fd) {
    NSString *text = noff_find_arg(argc, argv, "--text");
    if (text && text.length > 0) return text;
    text = noff_read_stdin(stdin_fd);
    if (text && text.length > 0) return text;
    return nil;
}

// ── Helper: sentiment label from score ──

static NSString *sentiment_label(double score) {
    if (score < -0.1) return @"negative";
    if (score > 0.1)  return @"positive";
    return @"neutral";
}

// ── Subcommand: language ──

static int cmd_language(int argc, char **argv, int stdin_fd, int stdout_fd,
                        int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *text = get_input_text(argc, argv, stdin_fd);
    if (!text) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"language",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No input text. Use --text or pipe via stdin.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NLLanguageRecognizer *recognizer = [[NLLanguageRecognizer alloc] init];
    [recognizer processString:text];

    NLLanguage dominant = recognizer.dominantLanguage;
    NSDictionary<NLLanguage, NSNumber *> *hypotheses = [recognizer languageHypothesesWithMaximum:5];

    NSMutableArray *hypoList = [NSMutableArray array];
    for (NLLanguage lang in hypotheses) {
        [hypoList addObject:@{
            @"language": lang ?: @"unknown",
            @"confidence": hypotheses[lang],
        }];
    }

    // Sort by confidence descending
    [hypoList sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        return [b[@"confidence"] compare:a[@"confidence"]];
    }];

    NSDictionary *dominantDict = @{
        @"language": dominant ?: @"unknown",
        @"confidence": hypotheses[dominant] ?: @(0),
    };

    NSDictionary *data = @{
        @"dominant": dominantDict,
        @"hypotheses": hypoList,
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"language", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: tokenize ──

static int cmd_tokenize(int argc, char **argv, int stdin_fd, int stdout_fd,
                         int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *text = get_input_text(argc, argv, stdin_fd);
    if (!text) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"tokenize",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No input text. Use --text or pipe via stdin.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NSString *unitStr = noff_find_arg(argc, argv, "--unit");
    if (!unitStr) unitStr = @"word";

    NLTokenUnit unit;
    if ([unitStr isEqualToString:@"sentence"]) {
        unit = NLTokenUnitSentence;
    } else if ([unitStr isEqualToString:@"paragraph"]) {
        unit = NLTokenUnitParagraph;
    } else {
        unit = NLTokenUnitWord;
        unitStr = @"word";
    }

    NLTokenizer *tokenizer = [[NLTokenizer alloc] initWithUnit:unit];
    [tokenizer setString:text];

    NSMutableArray *tokens = [NSMutableArray array];
    [tokenizer enumerateTokensInRange:NSMakeRange(0, text.length)
                           usingBlock:^(NSRange range, NLTokenizerAttributes attrs, BOOL *stop) {
        [tokens addObject:[text substringWithRange:range]];
    }];

    NSDictionary *data = @{
        @"unit": unitStr,
        @"tokens": tokens,
        @"count": @(tokens.count),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"tokenize", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: pos (part-of-speech tagging) ──

static int cmd_pos(int argc, char **argv, int stdin_fd, int stdout_fd,
                    int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *text = get_input_text(argc, argv, stdin_fd);
    if (!text) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"pos",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No input text. Use --text or pipe via stdin.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NLTagger *tagger = [[NLTagger alloc] initWithTagSchemes:@[
        NLTagSchemeTokenType, NLTagSchemeLexicalClass
    ]];
    [tagger setString:text];

    NSMutableArray *tokenTags = [NSMutableArray array];
    [tagger enumerateTagsInRange:NSMakeRange(0, text.length)
                            unit:NLTokenUnitWord
                          scheme:NLTagSchemeLexicalClass
                         options:NLTaggerOmitWhitespace | NLTaggerOmitPunctuation
                      usingBlock:^(NLTag tag, NSRange range, BOOL *stop) {
        NSString *token = [text substringWithRange:range];
        [tokenTags addObject:@{
            @"token": token,
            @"tag": tag ?: @"Other",
        }];
    }];

    NSDictionary *data = @{
        @"tokens": tokenTags,
        @"count": @(tokenTags.count),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"pos", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: ner (named entity recognition) ──

static int cmd_ner(int argc, char **argv, int stdin_fd, int stdout_fd,
                    int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *text = get_input_text(argc, argv, stdin_fd);
    if (!text) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"ner",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No input text. Use --text or pipe via stdin.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    NLTagger *tagger = [[NLTagger alloc] initWithTagSchemes:@[NLTagSchemeNameType]];
    [tagger setString:text];

    NSMutableArray *entities = [NSMutableArray array];
    [tagger enumerateTagsInRange:NSMakeRange(0, text.length)
                            unit:NLTokenUnitWord
                          scheme:NLTagSchemeNameType
                         options:NLTaggerOmitWhitespace | NLTaggerOmitPunctuation | NLTaggerJoinNames
                      usingBlock:^(NLTag tag, NSRange range, BOOL *stop) {
        if (!tag) return;
        if (![tag isEqualToString:NLTagPersonalName] &&
            ![tag isEqualToString:NLTagPlaceName] &&
            ![tag isEqualToString:NLTagOrganizationName]) {
            return;
        }

        NSString *entityText = [text substringWithRange:range];
        NSString *type;
        if ([tag isEqualToString:NLTagPersonalName])       type = @"PersonalName";
        else if ([tag isEqualToString:NLTagPlaceName])     type = @"PlaceName";
        else if ([tag isEqualToString:NLTagOrganizationName]) type = @"OrganizationName";
        else type = (NSString *)tag;

        [entities addObject:@{
            @"text": entityText,
            @"type": type,
            @"range": @{
                @"location": @(range.location),
                @"length": @(range.length),
            },
        }];
    }];

    NSDictionary *data = @{
        @"entities": entities,
        @"count": @(entities.count),
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"ner", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: sentiment ──

static int cmd_sentiment(int argc, char **argv, int stdin_fd, int stdout_fd,
                          int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *text = get_input_text(argc, argv, stdin_fd);
    if (!text) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"sentiment",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No input text. Use --text or pipe via stdin.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    BOOL perSentence = noff_has_flag(argc, argv, "--per-sentence");

    NLTagger *tagger = [[NLTagger alloc] initWithTagSchemes:@[NLTagSchemeSentimentScore]];
    [tagger setString:text];

    // Overall sentiment
    NLTag overallTag = [tagger tagAtIndex:0 unit:NLTokenUnitParagraph
                                   scheme:NLTagSchemeSentimentScore tokenRange:nil];
    double overallScore = overallTag ? [overallTag doubleValue] : 0.0;

    NSMutableDictionary *data = [NSMutableDictionary dictionary];
    data[@"score"] = @(overallScore);
    data[@"label"] = sentiment_label(overallScore);

    if (perSentence) {
        NLTokenizer *sentTokenizer = [[NLTokenizer alloc] initWithUnit:NLTokenUnitSentence];
        [sentTokenizer setString:text];

        NSMutableArray *sentences = [NSMutableArray array];
        [sentTokenizer enumerateTokensInRange:NSMakeRange(0, text.length)
                                   usingBlock:^(NSRange range, NLTokenizerAttributes attrs, BOOL *stop) {
            NSString *sentence = [text substringWithRange:range];

            NLTagger *sentTagger = [[NLTagger alloc] initWithTagSchemes:@[NLTagSchemeSentimentScore]];
            [sentTagger setString:sentence];

            NLTag sentTag = [sentTagger tagAtIndex:0 unit:NLTokenUnitParagraph
                                            scheme:NLTagSchemeSentimentScore tokenRange:nil];
            double sentScore = sentTag ? [sentTag doubleValue] : 0.0;

            [sentences addObject:@{
                @"text": sentence,
                @"score": @(sentScore),
                @"label": sentiment_label(sentScore),
            }];
        }];

        data[@"per_sentence"] = sentences;
    }

    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"sentiment", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: embed ──

static int cmd_embed(int argc, char **argv, int stdin_fd, int stdout_fd,
                      int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *text = get_input_text(argc, argv, stdin_fd);
    if (!text) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"embed",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No input text. Use --text or pipe via stdin.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // Detect language for embedding
    NLLanguageRecognizer *recognizer = [[NLLanguageRecognizer alloc] init];
    [recognizer processString:text];
    NLLanguage language = recognizer.dominantLanguage ?: NLLanguageEnglish;

    NLEmbedding *embedding = [NLEmbedding wordEmbeddingForLanguage:language];
    if (!embedding) {
        NSDictionary *err = noff_json_error(TOOL_NAME, @"embed",
                                             NOFF_ERR_NOT_AVAILABLE,
                                             [NSString stringWithFormat:
                                              @"No word embedding available for language: %@", language]);
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_NOT_AVAILABLE;
    }

    // Tokenize text into words
    NLTokenizer *tokenizer = [[NLTokenizer alloc] initWithUnit:NLTokenUnitWord];
    [tokenizer setString:text];

    NSMutableArray *words = [NSMutableArray array];
    [tokenizer enumerateTokensInRange:NSMakeRange(0, text.length)
                           usingBlock:^(NSRange range, NLTokenizerAttributes attrs, BOOL *stop) {
        NSString *word = [text substringWithRange:range];
        NSArray<NSNumber *> *vector = [embedding vectorForString:word];

        NSMutableDictionary *entry = [NSMutableDictionary dictionary];
        entry[@"word"] = word;
        if (vector) {
            entry[@"vector"] = vector;
            entry[@"dimension"] = @(embedding.dimension);
        } else {
            entry[@"vector"] = [NSNull null];
            entry[@"dimension"] = @(embedding.dimension);
        }
        [words addObject:entry];
    }];

    NSDictionary *data = @{
        @"words": words,
        @"model": [NSString stringWithFormat:@"NLEmbedding.word/%@", language],
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"embed", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Subcommand: analyze (all-in-one) ──

static int cmd_analyze(int argc, char **argv, int stdin_fd, int stdout_fd,
                        int stderr_fd, BOOL compact, BOOL quiet) {
    NSString *text = get_input_text(argc, argv, stdin_fd);
    if (!text) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"analyze",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No input text. Use --text or pipe via stdin.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    // Language detection
    NLLanguageRecognizer *recognizer = [[NLLanguageRecognizer alloc] init];
    [recognizer processString:text];
    NSString *language = recognizer.dominantLanguage ?: @"unknown";

    // Tokenize (word count)
    NLTokenizer *tokenizer = [[NLTokenizer alloc] initWithUnit:NLTokenUnitWord];
    [tokenizer setString:text];
    __block NSUInteger tokenCount = 0;
    [tokenizer enumerateTokensInRange:NSMakeRange(0, text.length)
                           usingBlock:^(NSRange range, NLTokenizerAttributes attrs, BOOL *stop) {
        tokenCount++;
    }];

    // POS tag counts
    NLTagger *posTagger = [[NLTagger alloc] initWithTagSchemes:@[NLTagSchemeLexicalClass]];
    [posTagger setString:text];
    NSMutableDictionary *posCounts = [NSMutableDictionary dictionary];
    [posTagger enumerateTagsInRange:NSMakeRange(0, text.length)
                               unit:NLTokenUnitWord
                             scheme:NLTagSchemeLexicalClass
                            options:NLTaggerOmitWhitespace | NLTaggerOmitPunctuation
                         usingBlock:^(NLTag tag, NSRange range, BOOL *stop) {
        NSString *t = tag ?: @"Other";
        posCounts[t] = @([posCounts[t] integerValue] + 1);
    }];

    // NER
    NLTagger *nerTagger = [[NLTagger alloc] initWithTagSchemes:@[NLTagSchemeNameType]];
    [nerTagger setString:text];
    NSMutableArray *entities = [NSMutableArray array];
    [nerTagger enumerateTagsInRange:NSMakeRange(0, text.length)
                               unit:NLTokenUnitWord
                             scheme:NLTagSchemeNameType
                            options:NLTaggerOmitWhitespace | NLTaggerOmitPunctuation | NLTaggerJoinNames
                         usingBlock:^(NLTag tag, NSRange range, BOOL *stop) {
        if (!tag) return;
        if (![tag isEqualToString:NLTagPersonalName] &&
            ![tag isEqualToString:NLTagPlaceName] &&
            ![tag isEqualToString:NLTagOrganizationName]) {
            return;
        }
        NSString *type;
        if ([tag isEqualToString:NLTagPersonalName])       type = @"PersonalName";
        else if ([tag isEqualToString:NLTagPlaceName])     type = @"PlaceName";
        else if ([tag isEqualToString:NLTagOrganizationName]) type = @"OrganizationName";
        else type = (NSString *)tag;

        [entities addObject:@{
            @"text": [text substringWithRange:range],
            @"type": type,
        }];
    }];

    // Sentiment
    NLTagger *sentTagger = [[NLTagger alloc] initWithTagSchemes:@[NLTagSchemeSentimentScore]];
    [sentTagger setString:text];
    NLTag sentTag = [sentTagger tagAtIndex:0 unit:NLTokenUnitParagraph
                                    scheme:NLTagSchemeSentimentScore tokenRange:nil];
    double sentScore = sentTag ? [sentTag doubleValue] : 0.0;

    NSDictionary *data = @{
        @"language": language,
        @"token_count": @(tokenCount),
        @"entities": entities,
        @"sentiment": @{
            @"score": @(sentScore),
            @"label": sentiment_label(sentScore),
        },
        @"pos_tags": posCounts,
    };
    noff_emit_json(stdout_fd, noff_json_envelope(TOOL_NAME, @"analyze", data), compact, quiet);
    return NOFF_EXIT_SUCCESS;
}

// ── Main handler ──

static int nlp_handler(int argc, char **argv,
                        int stdin_fd, int stdout_fd, int stderr_fd) {
    if (noff_has_flag(argc, argv, "--help") || noff_has_flag(argc, argv, "-h")) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        return NOFF_EXIT_SUCCESS;
    }

    BOOL compact = noff_has_flag(argc, argv, "--compact");
    BOOL quiet = noff_has_flag(argc, argv, "-q") || noff_has_flag(argc, argv, "--quiet");

    NSString *subcmd = noff_get_subcommand(argc, argv);
    if (!subcmd) {
        noff_emit_help(stderr_fd, HELP_TEXT);
        NSDictionary *err = noff_json_error(TOOL_NAME, @"unknown",
                                             NOFF_ERR_INVALID_ARGS,
                                             @"No command specified. Use --help for usage.");
        noff_emit_json(stdout_fd, err, compact, quiet);
        return NOFF_EXIT_INVALID_ARGS;
    }

    if ([subcmd isEqualToString:@"language"])   return cmd_language(argc, argv, stdin_fd, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"tokenize"])   return cmd_tokenize(argc, argv, stdin_fd, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"pos"])        return cmd_pos(argc, argv, stdin_fd, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"ner"])        return cmd_ner(argc, argv, stdin_fd, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"sentiment"])  return cmd_sentiment(argc, argv, stdin_fd, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"embed"])      return cmd_embed(argc, argv, stdin_fd, stdout_fd, stderr_fd, compact, quiet);
    if ([subcmd isEqualToString:@"analyze"])    return cmd_analyze(argc, argv, stdin_fd, stdout_fd, stderr_fd, compact, quiet);

    noff_emit_help(stderr_fd, HELP_TEXT);
    NSDictionary *err = noff_json_error(TOOL_NAME, subcmd,
                                         NOFF_ERR_INVALID_ARGS,
                                         [NSString stringWithFormat:@"Unknown command '%@'. Valid commands: language, sentiment, ner, pos, tokenize, analyze, embed. Use --help for details.", subcmd]);
    noff_emit_json(stdout_fd, err, compact, quiet);
    return NOFF_EXIT_INVALID_ARGS;
}

// ── Registration ──

void nlp_offload_register(void) {
    int err = native_offload_add_handler("apple-nlp", nlp_handler);
    if (err == 0) {
        noff_ensure_guest_stub("/usr/local/bin/apple-nlp");
        NSLog(@"NativeOffloads: apple-nlp handler registered");
    } else {
        NSLog(@"NativeOffloads: failed to register apple-nlp handler (err=%d)", err);
    }
}
