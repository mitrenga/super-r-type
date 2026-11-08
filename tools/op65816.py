"""op65816 — the 65C816 opcode matrix: mnemonic and addressing mode per opcode.

Shared by `scanhw.py` and (later) `dis65816.py`. Modes:

    imp  acc  imm  immM  immX  rel  rell  dp  dp,X  dp,Y  (dp)  (dp,X)  (dp),Y
    [dp]  [dp],Y  sr,S  (sr,S),Y  abs  abs,X  abs,Y  (abs)  (abs,X)  [abs]
    long  long,X  move  sig

`immM` / `immX` are immediates whose width follows the M / X flag — that
is why a 65C816 program cannot be disassembled linearly (`../CLAUDE.md`).
"""

_ROWS = '''
BRK sig   ORA (dp,X) COP sig   ORA sr,S  TSB dp    ORA dp    ASL dp    ORA [dp]
PHP imp   ORA immM  ASL acc   PHD imp   TSB abs   ORA abs   ASL abs   ORA long
BPL rel   ORA (dp),Y ORA (dp) ORA (sr,S),Y TRB dp ORA dp,X  ASL dp,X  ORA [dp],Y
CLC imp   ORA abs,Y INC acc   TCS imp   TRB abs   ORA abs,X ASL abs,X ORA long,X
JSR abs   AND (dp,X) JSL long AND sr,S  BIT dp    AND dp    ROL dp    AND [dp]
PLP imp   AND immM  ROL acc   PLD imp   BIT abs   AND abs   ROL abs   AND long
BMI rel   AND (dp),Y AND (dp) AND (sr,S),Y BIT dp,X AND dp,X ROL dp,X AND [dp],Y
SEC imp   AND abs,Y DEC acc   TSC imp   BIT abs,X AND abs,X ROL abs,X AND long,X
RTI imp   EOR (dp,X) WDM sig  EOR sr,S  MVP move  EOR dp    LSR dp    EOR [dp]
PHA imp   EOR immM  LSR acc   PHK imp   JMP abs   EOR abs   LSR abs   EOR long
BVC rel   EOR (dp),Y EOR (dp) EOR (sr,S),Y MVN move EOR dp,X LSR dp,X EOR [dp],Y
CLI imp   EOR abs,Y PHY imp   TCD imp   JML long  EOR abs,X LSR abs,X EOR long,X
RTS imp   ADC (dp,X) PER rell ADC sr,S  STZ dp    ADC dp    ROR dp    ADC [dp]
PLA imp   ADC immM  ROR acc   RTL imp   JMP (abs) ADC abs   ROR abs   ADC long
BVS rel   ADC (dp),Y ADC (dp) ADC (sr,S),Y STZ dp,X ADC dp,X ROR dp,X ADC [dp],Y
SEI imp   ADC abs,Y PLY imp   TDC imp   JMP (abs,X) ADC abs,X ROR abs,X ADC long,X
BRA rel   STA (dp,X) BRL rell STA sr,S  STY dp    STA dp    STX dp    STA [dp]
DEY imp   BIT immM  TXA imp   PHB imp   STY abs   STA abs   STX abs   STA long
BCC rel   STA (dp),Y STA (dp) STA (sr,S),Y STY dp,X STA dp,X STX dp,Y STA [dp],Y
TYA imp   STA abs,Y TXS imp   TXY imp   STZ abs   STA abs,X STZ abs,X STA long,X
LDY immX  LDA (dp,X) LDX immX LDA sr,S  LDY dp    LDA dp    LDX dp    LDA [dp]
TAY imp   LDA immM  TAX imp   PLB imp   LDY abs   LDA abs   LDX abs   LDA long
BCS rel   LDA (dp),Y LDA (dp) LDA (sr,S),Y LDY dp,X LDA dp,X LDX dp,Y LDA [dp],Y
CLV imp   LDA abs,Y TSX imp   TYX imp   LDY abs,X LDA abs,X LDX abs,Y LDA long,X
CPY immX  CMP (dp,X) REP imm  CMP sr,S  CPY dp    CMP dp    DEC dp    CMP [dp]
INY imp   CMP immM  DEX imp   WAI imp   CPY abs   CMP abs   DEC abs   CMP long
BNE rel   CMP (dp),Y CMP (dp) CMP (sr,S),Y PEI (dp) CMP dp,X DEC dp,X CMP [dp],Y
CLD imp   CMP abs,Y PHX imp   STP imp   JML [abs] CMP abs,X DEC abs,X CMP long,X
CPX immX  SBC (dp,X) SEP imm  SBC sr,S  CPX dp    SBC dp    INC dp    SBC [dp]
INX imp   SBC immM  NOP imp   XBA imp   CPX abs   SBC abs   INC abs   SBC long
BEQ rel   SBC (dp),Y SBC (dp) SBC (sr,S),Y PEA abs SBC dp,X INC dp,X SBC [dp],Y
SED imp   SBC abs,Y PLX imp   XCE imp   JSR (abs,X) SBC abs,X INC abs,X SBC long,X
'''

OPS = []
for _row in _ROWS.strip().splitlines():
    _t = _row.split()
    OPS.extend(zip(_t[0::2], _t[1::2]))
assert len(OPS) == 256

# operand bytes per mode; immM / immX are 1 or 2 (None = depends on the flag)
SIZE = {'imp': 0, 'acc': 0, 'imm': 1, 'immM': None, 'immX': None, 'rel': 1, 'rell': 2,
        'dp': 1, 'dp,X': 1, 'dp,Y': 1, '(dp)': 1, '(dp,X)': 1, '(dp),Y': 1, '[dp]': 1,
        '[dp],Y': 1, 'sr,S': 1, '(sr,S),Y': 1, 'abs': 2, 'abs,X': 2, 'abs,Y': 2,
        '(abs)': 2, '(abs,X)': 2, '[abs]': 2, 'long': 3, 'long,X': 3, 'move': 2, 'sig': 1}

# instructions whose operand is a code address, not data
FLOW = {'JMP', 'JML', 'JSR', 'JSL', 'PEA'}
