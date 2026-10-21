// OSRS model formats, mechanically converted from RuneLite's ModelLoader
// (tools/java2js-models.js in the HighLite-RE workspace) so the offset
// arithmetic stays exactly as in the original. Typed arrays stand in for
// Java's byte/short arrays; their wrap-around on assignment matches Java casts.
//
// Copyright (c) 2017, Adam <Adam@sigterm.info>
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this
//    list of conditions and the following disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright notice,
//    this list of conditions and the following disclaimer in the documentation
//    and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
// ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
// ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
/* eslint-disable */
import { ByteStream } from "./stream.js";

export function decodeType3(def, var1) {
		let var2 = new ByteStream(var1);
		let var3 = new ByteStream(var1);
		let var4 = new ByteStream(var1);
		let var5 = new ByteStream(var1);
		let var6 = new ByteStream(var1);
		let var7 = new ByteStream(var1);
		let var8 = new ByteStream(var1);
		var2.setOffset(var1.length - 26);
		let var9 = var2.readUnsignedShort();
		let var10 = var2.readUnsignedShort();
		let var11 = var2.readUnsignedByte();
		let var12 = var2.readUnsignedByte();
		let var13 = var2.readUnsignedByte();
		let var14 = var2.readUnsignedByte();
		let var15 = var2.readUnsignedByte();
		let var16 = var2.readUnsignedByte();
		let var17 = var2.readUnsignedByte();
		let var18 = var2.readUnsignedByte();
		let var19 = var2.readUnsignedShort();
		let var20 = var2.readUnsignedShort();
		let var21 = var2.readUnsignedShort();
		let var22 = var2.readUnsignedShort();
		let var23 = var2.readUnsignedShort();
		let var24 = var2.readUnsignedShort();
		let var25 = 0;
		let var26 = 0;
		let var27 = 0;
		let var28;
		if (var11 > 0)
		{
			def.textureRenderTypes = new Int8Array(var11);
			var2.setOffset(0);

			for (var28 = 0; var28 < var11; ++var28)
			{
				let var29 = def.textureRenderTypes[var28] = var2.readByte();
				if (var29 == 0)
				{
					++var25;
				}

				if (var29 >= 1 && var29 <= 3)
				{
					++var26;
				}

				if (var29 == 2)
				{
					++var27;
				}
			}
		}

		var28 = var11 + var9;
		let var58 = var28;
		if (var12 == 1)
		{
			var28 += var10;
		}

		let var30 = var28;
		var28 += var10;
		let var31 = var28;
		if (var13 == 255)
		{
			var28 += var10;
		}

		let var32 = var28;
		if (var15 == 1)
		{
			var28 += var10;
		}

		let var33 = var28;
		var28 += var24;
		let var34 = var28;
		if (var14 == 1)
		{
			var28 += var10;
		}

		let var35 = var28;
		var28 += var22;
		let var36 = var28;
		if (var16 == 1)
		{
			var28 += var10 * 2;
		}

		let var37 = var28;
		var28 += var23;
		let var38 = var28;
		var28 += var10 * 2;
		let var39 = var28;
		var28 += var19;
		let var40 = var28;
		var28 += var20;
		let var41 = var28;
		var28 += var21;
		let var42 = var28;
		var28 += var25 * 6;
		let var43 = var28;
		var28 += var26 * 6;
		let var44 = var28;
		var28 += var26 * 6;
		let var45 = var28;
		var28 += var26 * 2;
		let var46 = var28;
		var28 += var26;
		let var47 = var28;
		var28 = var28 + var26 * 2 + var27 * 2;
		def.vertexCount = var9;
		def.faceCount = var10;
		def.numTextureFaces = var11;
		def.vertexX = new Int32Array(var9);
		def.vertexY = new Int32Array(var9);
		def.vertexZ = new Int32Array(var9);
		def.faceIndices1 = new Int32Array(var10);
		def.faceIndices2 = new Int32Array(var10);
		def.faceIndices3 = new Int32Array(var10);
		if (var17 == 1)
		{
			def.packedVertexGroups = new Int32Array(var9);
		}

		if (var12 == 1)
		{
			def.faceRenderTypes = new Int8Array(var10);
		}

		if (var13 == 255)
		{
			def.faceRenderPriorities = new Int8Array(var10);
		}
		else
		{
			def.priority = var13;
		}

		if (var14 == 1)
		{
			def.faceTransparencies = new Int8Array(var10);
		}

		if (var15 == 1)
		{
			def.packedTransparencyVertexGroups = new Int32Array(var10);
		}

		if (var16 == 1)
		{
			def.faceTextures = new Int16Array(var10);
		}

		if (var16 == 1 && var11 > 0)
		{
			def.textureCoords = new Int8Array(var10);
		}

		if (var18 == 1)
		{
			def.animayaGroups = new Array(var9);
			def.animayaScales = new Array(var9);
		}

		def.faceColors = new Int16Array(var10);
		if (var11 > 0)
		{
			def.texIndices1 = new Int16Array(var11);
			def.texIndices2 = new Int16Array(var11);
			def.texIndices3 = new Int16Array(var11);
		}

		var2.setOffset(var11);
		var3.setOffset(var39);
		var4.setOffset(var40);
		var5.setOffset(var41);
		var6.setOffset(var33);
		let var48 = 0;
		let var49 = 0;
		let var50 = 0;

		let var51;
		let var52;
		let var53;
		let var54;
		let var55;
		for (var51 = 0; var51 < var9; ++var51)
		{
			var52 = var2.readUnsignedByte();
			var53 = 0;
			if ((var52 & 1) != 0)
			{
				var53 = var3.readShortSmart();
			}

			var54 = 0;
			if ((var52 & 2) != 0)
			{
				var54 = var4.readShortSmart();
			}

			var55 = 0;
			if ((var52 & 4) != 0)
			{
				var55 = var5.readShortSmart();
			}

			def.vertexX[var51] = var48 + var53;
			def.vertexY[var51] = var49 + var54;
			def.vertexZ[var51] = var50 + var55;
			var48 = def.vertexX[var51];
			var49 = def.vertexY[var51];
			var50 = def.vertexZ[var51];
			if (var17 == 1)
			{
				def.packedVertexGroups[var51] = var6.readUnsignedByte();
			}
		}

		if (var18 == 1)
		{
			for (var51 = 0; var51 < var9; ++var51)
			{
				var52 = var6.readUnsignedByte();
				def.animayaGroups[var51] = new Int32Array(var52);
				def.animayaScales[var51] = new Int32Array(var52);

				for (var53 = 0; var53 < var52; ++var53)
				{
					def.animayaGroups[var51][var53] = var6.readUnsignedByte();
					def.animayaScales[var51][var53] = var6.readUnsignedByte();
				}
			}
		}

		var2.setOffset(var38);
		var3.setOffset(var58);
		var4.setOffset(var31);
		var5.setOffset(var34);
		var6.setOffset(var32);
		var7.setOffset(var36);
		var8.setOffset(var37);

		for (var51 = 0; var51 < var10; ++var51)
		{
			def.faceColors[var51] = var2.readUnsignedShort();
			if (var12 == 1)
			{
				def.faceRenderTypes[var51] = var3.readByte();
			}

			if (var13 == 255)
			{
				def.faceRenderPriorities[var51] = var4.readByte();
			}

			if (var14 == 1)
			{
				def.faceTransparencies[var51] = var5.readByte();
			}

			if (var15 == 1)
			{
				def.packedTransparencyVertexGroups[var51] = var6.readUnsignedByte();
			}

			if (var16 == 1)
			{
				def.faceTextures[var51] = (var7.readUnsignedShort() - 1);
			}

			if (def.textureCoords != null && def.faceTextures[var51] != -1)
			{
				def.textureCoords[var51] = (var8.readUnsignedByte() - 1);
			}
		}

		var2.setOffset(var35);
		var3.setOffset(var30);
		var51 = 0;
		var52 = 0;
		var53 = 0;
		var54 = 0;

		let var56;
		for (var55 = 0; var55 < var10; ++var55)
		{
			var56 = var3.readUnsignedByte();
			if (var56 == 1)
			{
				var51 = var2.readShortSmart() + var54;
				var52 = var2.readShortSmart() + var51;
				var53 = var2.readShortSmart() + var52;
				var54 = var53;
				def.faceIndices1[var55] = var51;
				def.faceIndices2[var55] = var52;
				def.faceIndices3[var55] = var53;
			}

			if (var56 == 2)
			{
				var52 = var53;
				var53 = var2.readShortSmart() + var54;
				var54 = var53;
				def.faceIndices1[var55] = var51;
				def.faceIndices2[var55] = var52;
				def.faceIndices3[var55] = var53;
			}

			if (var56 == 3)
			{
				var51 = var53;
				var53 = var2.readShortSmart() + var54;
				var54 = var53;
				def.faceIndices1[var55] = var51;
				def.faceIndices2[var55] = var52;
				def.faceIndices3[var55] = var53;
			}

			if (var56 == 4)
			{
				let var57 = var51;
				var51 = var52;
				var52 = var57;
				var53 = var2.readShortSmart() + var54;
				var54 = var53;
				def.faceIndices1[var55] = var51;
				def.faceIndices2[var55] = var57;
				def.faceIndices3[var55] = var53;
			}
		}

		var2.setOffset(var42);
		var3.setOffset(var43);
		var4.setOffset(var44);
		var5.setOffset(var45);
		var6.setOffset(var46);
		var7.setOffset(var47);

		for (var55 = 0; var55 < var11; ++var55)
		{
			var56 = def.textureRenderTypes[var55] & 255;
			if (var56 == 0)
			{
				def.texIndices1[var55] = var2.readUnsignedShort();
				def.texIndices2[var55] = var2.readUnsignedShort();
				def.texIndices3[var55] = var2.readUnsignedShort();
			}
		}

		var2.setOffset(var28);
		var55 = var2.readUnsignedByte();
		if (var55 != 0)
		{
			var2.readUnsignedShort();
			var2.readUnsignedShort();
			var2.readUnsignedShort();
			var2.readInt();
		}

		let hasOffsets = var2.readUnsignedByte() == 1;
		if (hasOffsets)
		{
			def.faceZOffsets = new Int8Array(var10);

			for (let i = 0; i < var10; ++i)
			{
				def.faceZOffsets[i] = var2.readByte();
			}
		}
	}

export function decodeType2(def, var1) {
		let var2 = false;
		let var3 = false;
		let var4 = new ByteStream(var1);
		let var5 = new ByteStream(var1);
		let var6 = new ByteStream(var1);
		let var7 = new ByteStream(var1);
		let var8 = new ByteStream(var1);
		var4.setOffset(var1.length - 23);
		let var9 = var4.readUnsignedShort();
		let var10 = var4.readUnsignedShort();
		let var11 = var4.readUnsignedByte();
		let var12 = var4.readUnsignedByte();
		let var13 = var4.readUnsignedByte();
		let var14 = var4.readUnsignedByte();
		let var15 = var4.readUnsignedByte();
		let var16 = var4.readUnsignedByte();
		let var17 = var4.readUnsignedByte();
		let var18 = var4.readUnsignedShort();
		let var19 = var4.readUnsignedShort();
		let var20 = var4.readUnsignedShort();
		let var21 = var4.readUnsignedShort();
		let var22 = var4.readUnsignedShort();
		let var23 = 0;
		let var24 = var23 + var9;
		let var25 = var24;
		var24 += var10;
		let var26 = var24;
		if (var13 == 255)
		{
			var24 += var10;
		}

		let var27 = var24;
		if (var15 == 1)
		{
			var24 += var10;
		}

		let var28 = var24;
		if (var12 == 1)
		{
			var24 += var10;
		}

		let var29 = var24;
		var24 += var22;
		let var30 = var24;
		if (var14 == 1)
		{
			var24 += var10;
		}

		let var31 = var24;
		var24 += var21;
		let var32 = var24;
		var24 += var10 * 2;
		let var33 = var24;
		var24 += var11 * 6;
		let var34 = var24;
		var24 += var18;
		let var35 = var24;
		var24 += var19;
		let var36 = var24;
		var24 += var20;
		def.vertexCount = var9;
		def.faceCount = var10;
		def.numTextureFaces = var11;
		def.vertexX = new Int32Array(var9);
		def.vertexY = new Int32Array(var9);
		def.vertexZ = new Int32Array(var9);
		def.faceIndices1 = new Int32Array(var10);
		def.faceIndices2 = new Int32Array(var10);
		def.faceIndices3 = new Int32Array(var10);
		if (var11 > 0)
		{
			def.textureRenderTypes = new Int8Array(var11);
			def.texIndices1 = new Int16Array(var11);
			def.texIndices2 = new Int16Array(var11);
			def.texIndices3 = new Int16Array(var11);
		}

		if (var16 == 1)
		{
			def.packedVertexGroups = new Int32Array(var9);
		}

		if (var12 == 1)
		{
			def.faceRenderTypes = new Int8Array(var10);
			def.textureCoords = new Int8Array(var10);
			def.faceTextures = new Int16Array(var10);
		}

		if (var13 == 255)
		{
			def.faceRenderPriorities = new Int8Array(var10);
		}
		else
		{
			def.priority = var13;
		}

		if (var14 == 1)
		{
			def.faceTransparencies = new Int8Array(var10);
		}

		if (var15 == 1)
		{
			def.packedTransparencyVertexGroups = new Int32Array(var10);
		}

		if (var17 == 1)
		{
			def.animayaGroups = new Array(var9);
			def.animayaScales = new Array(var9);
		}

		def.faceColors = new Int16Array(var10);
		var4.setOffset(var23);
		var5.setOffset(var34);
		var6.setOffset(var35);
		var7.setOffset(var36);
		var8.setOffset(var29);
		let var37 = 0;
		let var38 = 0;
		let var39 = 0;

		let var40;
		let var41;
		let var42;
		let var43;
		let var44;
		for (var40 = 0; var40 < var9; ++var40)
		{
			var41 = var4.readUnsignedByte();
			var42 = 0;
			if ((var41 & 1) != 0)
			{
				var42 = var5.readShortSmart();
			}

			var43 = 0;
			if ((var41 & 2) != 0)
			{
				var43 = var6.readShortSmart();
			}

			var44 = 0;
			if ((var41 & 4) != 0)
			{
				var44 = var7.readShortSmart();
			}

			def.vertexX[var40] = var37 + var42;
			def.vertexY[var40] = var38 + var43;
			def.vertexZ[var40] = var39 + var44;
			var37 = def.vertexX[var40];
			var38 = def.vertexY[var40];
			var39 = def.vertexZ[var40];
			if (var16 == 1)
			{
				def.packedVertexGroups[var40] = var8.readUnsignedByte();
			}
		}

		if (var17 == 1)
		{
			for (var40 = 0; var40 < var9; ++var40)
			{
				var41 = var8.readUnsignedByte();
				def.animayaGroups[var40] = new Int32Array(var41);
				def.animayaScales[var40] = new Int32Array(var41);

				for (var42 = 0; var42 < var41; ++var42)
				{
					def.animayaGroups[var40][var42] = var8.readUnsignedByte();
					def.animayaScales[var40][var42] = var8.readUnsignedByte();
				}
			}
		}

		var4.setOffset(var32);
		var5.setOffset(var28);
		var6.setOffset(var26);
		var7.setOffset(var30);
		var8.setOffset(var27);

		for (var40 = 0; var40 < var10; ++var40)
		{
			def.faceColors[var40] = var4.readUnsignedShort();
			if (var12 == 1)
			{
				var41 = var5.readUnsignedByte();
				if ((var41 & 1) == 1)
				{
					def.faceRenderTypes[var40] = 1;
					var2 = true;
				}
				else
				{
					def.faceRenderTypes[var40] = 0;
				}

				if ((var41 & 2) == 2)
				{
					def.textureCoords[var40] = (var41 >> 2);
					def.faceTextures[var40] = def.faceColors[var40];
					def.faceColors[var40] = 127;
					if (def.faceTextures[var40] != -1)
					{
						var3 = true;
					}
				}
				else
				{
					def.textureCoords[var40] = -1;
					def.faceTextures[var40] = -1;
				}
			}

			if (var13 == 255)
			{
				def.faceRenderPriorities[var40] = var6.readByte();
			}

			if (var14 == 1)
			{
				def.faceTransparencies[var40] = var7.readByte();
			}

			if (var15 == 1)
			{
				def.packedTransparencyVertexGroups[var40] = var8.readUnsignedByte();
			}
		}

		var4.setOffset(var31);
		var5.setOffset(var25);
		var40 = 0;
		var41 = 0;
		var42 = 0;
		var43 = 0;

		let var45;
		let var46;
		for (var44 = 0; var44 < var10; ++var44)
		{
			var45 = var5.readUnsignedByte();
			if (var45 == 1)
			{
				var40 = var4.readShortSmart() + var43;
				var41 = var4.readShortSmart() + var40;
				var42 = var4.readShortSmart() + var41;
				var43 = var42;
				def.faceIndices1[var44] = var40;
				def.faceIndices2[var44] = var41;
				def.faceIndices3[var44] = var42;
			}

			if (var45 == 2)
			{
				var41 = var42;
				var42 = var4.readShortSmart() + var43;
				var43 = var42;
				def.faceIndices1[var44] = var40;
				def.faceIndices2[var44] = var41;
				def.faceIndices3[var44] = var42;
			}

			if (var45 == 3)
			{
				var40 = var42;
				var42 = var4.readShortSmart() + var43;
				var43 = var42;
				def.faceIndices1[var44] = var40;
				def.faceIndices2[var44] = var41;
				def.faceIndices3[var44] = var42;
			}

			if (var45 == 4)
			{
				var46 = var40;
				var40 = var41;
				var41 = var46;
				var42 = var4.readShortSmart() + var43;
				var43 = var42;
				def.faceIndices1[var44] = var40;
				def.faceIndices2[var44] = var46;
				def.faceIndices3[var44] = var42;
			}
		}

		var4.setOffset(var33);

		for (var44 = 0; var44 < var11; ++var44)
		{
			def.textureRenderTypes[var44] = 0;
			def.texIndices1[var44] = var4.readUnsignedShort();
			def.texIndices2[var44] = var4.readUnsignedShort();
			def.texIndices3[var44] = var4.readUnsignedShort();
		}

		var4.setOffset(var24);
		let hasOffsets = var4.readUnsignedByte() == 1;
		if (hasOffsets)
		{
			def.faceZOffsets = new Int8Array(var10);

			for (var45 = 0; var45 < var10; ++var45)
			{
				def.faceZOffsets[var45] = var4.readByte();
			}
		}

		if (def.textureCoords != null)
		{
			let var47 = false;

			for (var45 = 0; var45 < var10; ++var45)
			{
				var46 = def.textureCoords[var45] & 255;
				if (var46 != 255)
				{
					if (def.faceIndices1[var45] == (def.texIndices1[var46] & '\uffff') && def.faceIndices2[var45] == (def.texIndices2[var46] & '\uffff') && def.faceIndices3[var45] == (def.texIndices3[var46] & '\uffff'))
					{
						def.textureCoords[var45] = -1;
					}
					else
					{
						var47 = true;
					}
				}
			}

			if (!var47)
			{
				def.textureCoords = null;
			}
		}

		if (!var3)
		{
			def.faceTextures = null;
		}

		if (!var2)
		{
			def.faceRenderTypes = null;
		}

	}

export function decodeType1(def, var1) {
		let var2 = new ByteStream(var1);
		let var3 = new ByteStream(var1);
		let var4 = new ByteStream(var1);
		let var5 = new ByteStream(var1);
		let var6 = new ByteStream(var1);
		let var7 = new ByteStream(var1);
		let var8 = new ByteStream(var1);
		var2.setOffset(var1.length - 23);
		let var9 = var2.readUnsignedShort();
		let var10 = var2.readUnsignedShort();
		let var11 = var2.readUnsignedByte();
		let var12 = var2.readUnsignedByte();
		let var13 = var2.readUnsignedByte();
		let var14 = var2.readUnsignedByte();
		let var15 = var2.readUnsignedByte();
		let var16 = var2.readUnsignedByte();
		let var17 = var2.readUnsignedByte();
		let var18 = var2.readUnsignedShort();
		let var19 = var2.readUnsignedShort();
		let var20 = var2.readUnsignedShort();
		let var21 = var2.readUnsignedShort();
		let var22 = var2.readUnsignedShort();
		let var23 = 0;
		let var24 = 0;
		let var25 = 0;
		let var26;
		if (var11 > 0)
		{
			def.textureRenderTypes = new Int8Array(var11);
			var2.setOffset(0);

			for (var26 = 0; var26 < var11; ++var26)
			{
				let var27 = def.textureRenderTypes[var26] = var2.readByte();
				if (var27 == 0)
				{
					++var23;
				}

				if (var27 >= 1 && var27 <= 3)
				{
					++var24;
				}

				if (var27 == 2)
				{
					++var25;
				}
			}
		}

		var26 = var11 + var9;
		let var56 = var26;
		if (var12 == 1)
		{
			var26 += var10;
		}

		let var28 = var26;
		var26 += var10;
		let var29 = var26;
		if (var13 == 255)
		{
			var26 += var10;
		}

		let var30 = var26;
		if (var15 == 1)
		{
			var26 += var10;
		}

		let var31 = var26;
		if (var17 == 1)
		{
			var26 += var9;
		}

		let var32 = var26;
		if (var14 == 1)
		{
			var26 += var10;
		}

		let var33 = var26;
		var26 += var21;
		let var34 = var26;
		if (var16 == 1)
		{
			var26 += var10 * 2;
		}

		let var35 = var26;
		var26 += var22;
		let var36 = var26;
		var26 += var10 * 2;
		let var37 = var26;
		var26 += var18;
		let var38 = var26;
		var26 += var19;
		let var39 = var26;
		var26 += var20;
		let var40 = var26;
		var26 += var23 * 6;
		let var41 = var26;
		var26 += var24 * 6;
		let var42 = var26;
		var26 += var24 * 6;
		let var43 = var26;
		var26 += var24 * 2;
		let var44 = var26;
		var26 += var24;
		let var45 = var26;
		var26 = var26 + var24 * 2 + var25 * 2;
		def.vertexCount = var9;
		def.faceCount = var10;
		def.numTextureFaces = var11;
		def.vertexX = new Int32Array(var9);
		def.vertexY = new Int32Array(var9);
		def.vertexZ = new Int32Array(var9);
		def.faceIndices1 = new Int32Array(var10);
		def.faceIndices2 = new Int32Array(var10);
		def.faceIndices3 = new Int32Array(var10);
		if (var17 == 1)
		{
			def.packedVertexGroups = new Int32Array(var9);
		}

		if (var12 == 1)
		{
			def.faceRenderTypes = new Int8Array(var10);
		}

		if (var13 == 255)
		{
			def.faceRenderPriorities = new Int8Array(var10);
		}
		else
		{
			def.priority = var13;
		}

		if (var14 == 1)
		{
			def.faceTransparencies = new Int8Array(var10);
		}

		if (var15 == 1)
		{
			def.packedTransparencyVertexGroups = new Int32Array(var10);
		}

		if (var16 == 1)
		{
			def.faceTextures = new Int16Array(var10);
		}

		if (var16 == 1 && var11 > 0)
		{
			def.textureCoords = new Int8Array(var10);
		}

		def.faceColors = new Int16Array(var10);
		if (var11 > 0)
		{
			def.texIndices1 = new Int16Array(var11);
			def.texIndices2 = new Int16Array(var11);
			def.texIndices3 = new Int16Array(var11);
		}

		var2.setOffset(var11);
		var3.setOffset(var37);
		var4.setOffset(var38);
		var5.setOffset(var39);
		var6.setOffset(var31);
		let var46 = 0;
		let var47 = 0;
		let var48 = 0;

		let var49;
		let var50;
		let var51;
		let var52;
		let var53;
		for (var49 = 0; var49 < var9; ++var49)
		{
			var50 = var2.readUnsignedByte();
			var51 = 0;
			if ((var50 & 1) != 0)
			{
				var51 = var3.readShortSmart();
			}

			var52 = 0;
			if ((var50 & 2) != 0)
			{
				var52 = var4.readShortSmart();
			}

			var53 = 0;
			if ((var50 & 4) != 0)
			{
				var53 = var5.readShortSmart();
			}

			def.vertexX[var49] = var46 + var51;
			def.vertexY[var49] = var47 + var52;
			def.vertexZ[var49] = var48 + var53;
			var46 = def.vertexX[var49];
			var47 = def.vertexY[var49];
			var48 = def.vertexZ[var49];
			if (var17 == 1)
			{
				def.packedVertexGroups[var49] = var6.readUnsignedByte();
			}
		}

		var2.setOffset(var36);
		var3.setOffset(var56);
		var4.setOffset(var29);
		var5.setOffset(var32);
		var6.setOffset(var30);
		var7.setOffset(var34);
		var8.setOffset(var35);

		for (var49 = 0; var49 < var10; ++var49)
		{
			def.faceColors[var49] = var2.readUnsignedShort();
			if (var12 == 1)
			{
				def.faceRenderTypes[var49] = var3.readByte();
			}

			if (var13 == 255)
			{
				def.faceRenderPriorities[var49] = var4.readByte();
			}

			if (var14 == 1)
			{
				def.faceTransparencies[var49] = var5.readByte();
			}

			if (var15 == 1)
			{
				def.packedTransparencyVertexGroups[var49] = var6.readUnsignedByte();
			}

			if (var16 == 1)
			{
				def.faceTextures[var49] = (var7.readUnsignedShort() - 1);
			}

			if (def.textureCoords != null && def.faceTextures[var49] != -1)
			{
				def.textureCoords[var49] = (var8.readUnsignedByte() - 1);
			}
		}

		var2.setOffset(var33);
		var3.setOffset(var28);
		var49 = 0;
		var50 = 0;
		var51 = 0;
		var52 = 0;

		let var54;
		for (var53 = 0; var53 < var10; ++var53)
		{
			var54 = var3.readUnsignedByte();
			if (var54 == 1)
			{
				var49 = var2.readShortSmart() + var52;
				var50 = var2.readShortSmart() + var49;
				var51 = var2.readShortSmart() + var50;
				var52 = var51;
				def.faceIndices1[var53] = var49;
				def.faceIndices2[var53] = var50;
				def.faceIndices3[var53] = var51;
			}

			if (var54 == 2)
			{
				var50 = var51;
				var51 = var2.readShortSmart() + var52;
				var52 = var51;
				def.faceIndices1[var53] = var49;
				def.faceIndices2[var53] = var50;
				def.faceIndices3[var53] = var51;
			}

			if (var54 == 3)
			{
				var49 = var51;
				var51 = var2.readShortSmart() + var52;
				var52 = var51;
				def.faceIndices1[var53] = var49;
				def.faceIndices2[var53] = var50;
				def.faceIndices3[var53] = var51;
			}

			if (var54 == 4)
			{
				let var55 = var49;
				var49 = var50;
				var50 = var55;
				var51 = var2.readShortSmart() + var52;
				var52 = var51;
				def.faceIndices1[var53] = var49;
				def.faceIndices2[var53] = var55;
				def.faceIndices3[var53] = var51;
			}
		}

		var2.setOffset(var40);
		var3.setOffset(var41);
		var4.setOffset(var42);
		var5.setOffset(var43);
		var6.setOffset(var44);
		var7.setOffset(var45);

		for (var53 = 0; var53 < var11; ++var53)
		{
			var54 = def.textureRenderTypes[var53] & 255;
			if (var54 == 0)
			{
				def.texIndices1[var53] = var2.readUnsignedShort();
				def.texIndices2[var53] = var2.readUnsignedShort();
				def.texIndices3[var53] = var2.readUnsignedShort();
			}
		}

		var2.setOffset(var26);
		var53 = var2.readUnsignedByte();
		if (var53 != 0)
		{
			var2.readUnsignedShort();
			var2.readUnsignedShort();
			var2.readUnsignedShort();
			var2.readInt();
		}

	}

export function decodeOldFormat(def, inputData) {
		let usesFaceRenderTypes = false;
		let usesFaceTextures = false;
		let stream1 = new ByteStream(inputData);
		let stream2 = new ByteStream(inputData);
		let stream3 = new ByteStream(inputData);
		let stream4 = new ByteStream(inputData);
		let stream5 = new ByteStream(inputData);
		stream1.setOffset(inputData.length - 18);
		let vertexCount = stream1.readUnsignedShort();
		let faceCount = stream1.readUnsignedShort();
		let textureCount = stream1.readUnsignedByte();
		let isTextured = stream1.readUnsignedByte();
		let faceRenderPriority = stream1.readUnsignedByte();
		let hasFaceTransparencies = stream1.readUnsignedByte();
		let hasPackedTransparencyVertexGroups = stream1.readUnsignedByte();
		let hasPackedVertexGroups = stream1.readUnsignedByte();
		let vertexXDataByteCount = stream1.readUnsignedShort();
		let vertexYDataByteCount = stream1.readUnsignedShort();
		let vertezZDataByteCount = stream1.readUnsignedShort();
		let faceIndexDataByteCount = stream1.readUnsignedShort();
		let offsetOfVertexFlags = 0;
		let dataOffset = offsetOfVertexFlags + vertexCount;
		let offsetOfFaceIndexCompressionTypes = dataOffset;
		dataOffset += faceCount;
		let offsetOfFaceRenderPriorities = dataOffset;
		if (faceRenderPriority == 255)
		{
			dataOffset += faceCount;
		}

		let offsetOfPackedTransparencyVertexGroups = dataOffset;
		if (hasPackedTransparencyVertexGroups == 1)
		{
			dataOffset += faceCount;
		}

		let offsetOfFaceTextureFlags = dataOffset;
		if (isTextured == 1)
		{
			dataOffset += faceCount;
		}

		let offsetOfPackedVertexGroups = dataOffset;
		if (hasPackedVertexGroups == 1)
		{
			dataOffset += vertexCount;
		}

		let offsetOfFaceTransparencies = dataOffset;
		if (hasFaceTransparencies == 1)
		{
			dataOffset += faceCount;
		}

		let offsetOfFaceIndexData = dataOffset;
		dataOffset += faceIndexDataByteCount;
		let offsetOfFaceColorsOrFaceTextures = dataOffset;
		dataOffset += faceCount * 2;
		let offsetOfTextureIndices = dataOffset;
		dataOffset += textureCount * 6;
		let offsetOfVertexXData = dataOffset;
		dataOffset += vertexXDataByteCount;
		let offsetOfVertexYData = dataOffset;
		dataOffset += vertexYDataByteCount;
		let offsetOfVertexZData = dataOffset;
		def.vertexCount = vertexCount;
		def.faceCount = faceCount;
		def.numTextureFaces = textureCount;
		def.vertexX = new Int32Array(vertexCount);
		def.vertexY = new Int32Array(vertexCount);
		def.vertexZ = new Int32Array(vertexCount);
		def.faceIndices1 = new Int32Array(faceCount);
		def.faceIndices2 = new Int32Array(faceCount);
		def.faceIndices3 = new Int32Array(faceCount);
		if (textureCount > 0)
		{
			def.textureRenderTypes = new Int8Array(textureCount);
			def.texIndices1 = new Int16Array(textureCount);
			def.texIndices2 = new Int16Array(textureCount);
			def.texIndices3 = new Int16Array(textureCount);
		}

		if (hasPackedVertexGroups == 1)
		{
			def.packedVertexGroups = new Int32Array(vertexCount);
		}

		if (isTextured == 1)
		{
			def.faceRenderTypes = new Int8Array(faceCount);
			def.textureCoords = new Int8Array(faceCount);
			def.faceTextures = new Int16Array(faceCount);
		}

		if (faceRenderPriority == 255)
		{
			def.faceRenderPriorities = new Int8Array(faceCount);
		}
		else
		{
			def.priority = faceRenderPriority;
		}

		if (hasFaceTransparencies == 1)
		{
			def.faceTransparencies = new Int8Array(faceCount);
		}

		if (hasPackedTransparencyVertexGroups == 1)
		{
			def.packedTransparencyVertexGroups = new Int32Array(faceCount);
		}

		def.faceColors = new Int16Array(faceCount);
		stream1.setOffset(offsetOfVertexFlags);
		stream2.setOffset(offsetOfVertexXData);
		stream3.setOffset(offsetOfVertexYData);
		stream4.setOffset(offsetOfVertexZData);
		stream5.setOffset(offsetOfPackedVertexGroups);
		let previousVertexX = 0;
		let previousVertexY = 0;
		let previousVertexZ = 0;

		for (let i = 0; i < vertexCount; ++i)
		{
			let vertexFlags = stream1.readUnsignedByte();
			let deltaX = 0;
			if ((vertexFlags & 1) != 0)
			{
				deltaX = stream2.readShortSmart();
			}

			let deltaY = 0;
			if ((vertexFlags & 2) != 0)
			{
				deltaY = stream3.readShortSmart();
			}

			let deltaZ = 0;
			if ((vertexFlags & 4) != 0)
			{
				deltaZ = stream4.readShortSmart();
			}

			def.vertexX[i] = previousVertexX + deltaX;
			def.vertexY[i] = previousVertexY + deltaY;
			def.vertexZ[i] = previousVertexZ + deltaZ;
			previousVertexX = def.vertexX[i];
			previousVertexY = def.vertexY[i];
			previousVertexZ = def.vertexZ[i];
			if (hasPackedVertexGroups == 1)
			{
				def.packedVertexGroups[i] = stream5.readUnsignedByte();
			}
		}

		stream1.setOffset(offsetOfFaceColorsOrFaceTextures);
		stream2.setOffset(offsetOfFaceTextureFlags);
		stream3.setOffset(offsetOfFaceRenderPriorities);
		stream4.setOffset(offsetOfFaceTransparencies);
		stream5.setOffset(offsetOfPackedTransparencyVertexGroups);

		for (let i = 0; i < faceCount; ++i)
		{
			def.faceColors[i] = stream1.readUnsignedShort();
			if (isTextured == 1)
			{
				let faceTextureFlags = stream2.readUnsignedByte();
				if ((faceTextureFlags & 1) == 1)
				{
					def.faceRenderTypes[i] = 1;
					usesFaceRenderTypes = true;
				}
				else
				{
					def.faceRenderTypes[i] = 0;
				}

				if ((faceTextureFlags & 2) == 2)
				{
					def.textureCoords[i] = (faceTextureFlags >> 2);
					def.faceTextures[i] = def.faceColors[i];
					def.faceColors[i] = 127;
					if (def.faceTextures[i] != -1)
					{
						usesFaceTextures = true;
					}
				}
				else
				{
					def.textureCoords[i] = -1;
					def.faceTextures[i] = -1;
				}
			}

			if (faceRenderPriority == 255)
			{
				def.faceRenderPriorities[i] = stream3.readByte();
			}

			if (hasFaceTransparencies == 1)
			{
				def.faceTransparencies[i] = stream4.readByte();
			}

			if (hasPackedTransparencyVertexGroups == 1)
			{
				def.packedTransparencyVertexGroups[i] = stream5.readUnsignedByte();
			}
		}

		stream1.setOffset(offsetOfFaceIndexData);
		stream2.setOffset(offsetOfFaceIndexCompressionTypes);
		let previousIndex1 = 0;
		let previousIndex2 = 0;
		let previousIndex3 = 0;

		for (let i = 0; i < faceCount; ++i)
		{
			let faceIndexCompressionType = stream2.readUnsignedByte();
			if (faceIndexCompressionType == 1)
			{
				previousIndex1 = stream1.readShortSmart() + previousIndex3;
				previousIndex2 = stream1.readShortSmart() + previousIndex1;
				previousIndex3 = stream1.readShortSmart() + previousIndex2;
				def.faceIndices1[i] = previousIndex1;
				def.faceIndices2[i] = previousIndex2;
				def.faceIndices3[i] = previousIndex3;
			}

			if (faceIndexCompressionType == 2)
			{
				previousIndex2 = previousIndex3;
				previousIndex3 = stream1.readShortSmart() + previousIndex3;
				def.faceIndices1[i] = previousIndex1;
				def.faceIndices2[i] = previousIndex2;
				def.faceIndices3[i] = previousIndex3;
			}

			if (faceIndexCompressionType == 3)
			{
				previousIndex1 = previousIndex3;
				previousIndex3 = stream1.readShortSmart() + previousIndex3;
				def.faceIndices1[i] = previousIndex1;
				def.faceIndices2[i] = previousIndex2;
				def.faceIndices3[i] = previousIndex3;
			}

			if (faceIndexCompressionType == 4)
			{
				let swap = previousIndex1;
				previousIndex1 = previousIndex2;
				previousIndex2 = swap;
				previousIndex3 = stream1.readShortSmart() + previousIndex3;
				def.faceIndices1[i] = previousIndex1;
				def.faceIndices2[i] = previousIndex2;
				def.faceIndices3[i] = previousIndex3;
			}
		}

		stream1.setOffset(offsetOfTextureIndices);

		for (let i = 0; i < textureCount; ++i)
		{
			def.textureRenderTypes[i] = 0;
			def.texIndices1[i] = stream1.readUnsignedShort();
			def.texIndices2[i] = stream1.readUnsignedShort();
			def.texIndices3[i] = stream1.readUnsignedShort();
		}

		if (def.textureCoords != null)
		{
			let usesTextureCoords = false;

			for (let i = 0; i < faceCount; ++i)
			{
				let coord = def.textureCoords[i] & 255;
				if (coord != 255)
				{
					if (def.faceIndices1[i] == (def.texIndices1[coord] & '\uffff') && def.faceIndices2[i] == (def.texIndices2[coord] & '\uffff') && def.faceIndices3[i] == (def.texIndices3[coord] & '\uffff'))
					{
						def.textureCoords[i] = -1;
					}
					else
					{
						usesTextureCoords = true;
					}
				}
			}

			if (!usesTextureCoords)
			{
				def.textureCoords = null;
			}
		}

		if (!usesFaceTextures)
		{
			def.faceTextures = null;
		}

		if (!usesFaceRenderTypes)
		{
			def.faceRenderTypes = null;
		}

	}